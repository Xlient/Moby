"""Spec for the fusion graph's deterministic rules (plan v3 §10). Written before the code.

Skipped until `moby/graph/policy.py` exists. These are pure functions, no LLM and no
database, so they're fast and they guard the scariest bugs (a wrong tier, a skipped review).

Rules from the plan:
  * Tier is VERIFICATION, not severity:
      0 unverified (logged) → 1 corroborated (reviewer notified) → 2 confirmed (public alert).
  * Only DISTINCT people corroborate: repeats from one person and mesh relay hops never count.
  * Tier 2 for community events needs an official match or reviewer approval. (The plan also
    allows "high corroboration"; we chose a human gate on every community alert. Change
    HIGH_CORROBORATION_PROMOTES if you decide otherwise.)
  * Severity floor: a single critical report goes to review right away.
  * Conflicting reports go to review, never averaged.

Lines marked DECISION are choices, not facts: change the expected values if you decide
differently, and the tests keep you honest about the rule you picked.
"""
import pytest
from langgraph.graph import END

policy = pytest.importorskip("moby.graph.policy", reason="moby/graph/policy.py not written yet")

CORROBORATION_MIN = 2            # DECISION: distinct people needed for tier 1
HIGH_CORROBORATION_PROMOTES = False  # DECISION: never auto-promote a community event to tier 2


# ── distinct reporters ───────────────────────────────────────────────────────

def rep(who, source="manual", relayed_by=()):
    return {"reporter_hash": who, "source": source, "relayed_by": list(relayed_by)}


@pytest.mark.parametrize("reports, expected", [
    ([], 0),
    ([rep("a")], 1),
    ([rep("a"), rep("b"), rep("c")], 3),
    ([rep("a"), rep("a"), rep("a")], 1),                                        # one person, three reports
    ([rep("a", "mesh", ["r1", "r2"])], 1),                                      # relays are not reporters
    ([rep("a", "mesh", ["b"]), rep("b")], 2),                                   # b relayed AND reported: counts once, as a reporter
])
def test_count_distinct_reporters(reports, expected):
    assert policy.count_distinct_reporters(reports) == expected


# ── tier ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("distinct, official_match, expected", [
    (1, False, 0),
    (CORROBORATION_MIN - 1, False, 0),
    (CORROBORATION_MIN, False, 1),
    (10, False, 2 if HIGH_CORROBORATION_PROMOTES else 1),
    (1, True, 2),                     # an official source already confirmed it
])
def test_assign_tier(distinct, official_match, expected):
    assert policy.assign_tier(distinct, official_match) == expected


# ── conflicts ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("severities, expected", [
    (["high"], False),
    (["high", "high", "medium"], False),     # neighbours on the scale: normal disagreement
    (["critical", "low"], True),             # DECISION: 2+ steps apart is a conflict
    (["critical", "medium"], True),
    (["high", "low"], True),
    (["medium", "low"], False),
])
def test_is_conflicting(severities, expected):
    assert policy.is_conflicting(severities) == expected


# ── review reason (None = no human review needed) ────────────────────────────

@pytest.mark.parametrize("tier, severity, conflicting, expected", [
    (0, "low", False, None),                              # logged only
    (0, "critical", False, "severity_floor"),             # single critical report
    (1, "medium", False, "tier1_corroborated"),
    (1, "critical", False, "severity_floor"),             # floor wins: reviewers see it first
    (1, "high", True, "conflicting_reports"),
    (0, "low", True, "conflicting_reports"),
    (2, "critical", False, None),                         # official match: already confirmed
])
def test_review_reason(tier, severity, conflicting, expected):
    assert policy.review_reason(tier, severity, conflicting) == expected


def test_review_reasons_match_the_review_queue_table():
    # migration 0006 only accepts these; anything else fails the INSERT
    allowed = {"tier1_corroborated", "severity_floor", "conflicting_reports", "low_confidence", None}
    for tier in (0, 1, 2):
        for severity in ("low", "medium", "high", "critical"):
            for conflicting in (False, True):
                assert policy.review_reason(tier, severity, conflicting) in allowed


# ── routing (the conditional edge) ───────────────────────────────────────────

@pytest.mark.parametrize("state, expected", [
    ({"tier": 0, "review_reason": None}, END),
    ({"tier": 0, "review_reason": "severity_floor"}, "human_review"),
    ({"tier": 1, "review_reason": "tier1_corroborated"}, "human_review"),
    ({"tier": 2, "review_reason": None}, "draft_alert"),
])
def test_route_by_tier(state, expected):
    # State keys "tier" / "review_reason" and node names are suggestions: rename here if yours differ.
    assert policy.route_by_tier(state) == expected


@pytest.mark.parametrize("decision, expected", [
    ("approve", "draft_alert"),
    ("reject", END),
    ("hold", END),           # DECISION: hold = stays out of public alerts until decided again
])
def test_route_after_review(decision, expected):
    assert policy.route_after_review({"reviewer_decision": decision}) == expected
