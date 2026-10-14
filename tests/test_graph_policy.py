"""Spec for the fusion graph's deterministic rules (plan v3 §10). Written before the code.

Skipped until `moby/graph/policy.py` exists. These are pure functions, no LLM and no
database, so they're fast and they guard the scariest bugs (a wrong tier, a skipped review).

Rules (decided 2026-10-14: no review gate):
  * Tier is VERIFICATION, not severity:
      0 = one person, 1 = 2+ different people, 2 = matches an official warning.
    Community events are delivered without waiting for anyone, always labelled unverified,
    to people whose community_reports choice includes them (tier 0 opt-in, tier 1 default).
  * Only DISTINCT people corroborate: repeats from one person and mesh relay hops never count.
  * Only an official match makes tier 2. Lots of people agreeing is still "unverified".
  * Conflicting reports: never averaged. The event takes the HIGHEST severity and sets
    reports_disagree (a missed danger is worse than an over-warning).
  * Review is optional (local partners). review_reason only flags an event for them;
    the graph never pauses for it.

Lines marked DECISION are choices, not facts: change the expected values if you decide
differently, and the tests keep you honest about the rule you picked.
"""
import pytest
from langgraph.graph import END

policy = pytest.importorskip("moby.graph.policy", reason="moby/graph/policy.py not written yet")

CORROBORATION_MIN = 2            # DECISION: distinct people needed for tier 1
HIGH_CORROBORATION_PROMOTES = False  # decided: only an official match makes tier 2


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


@pytest.mark.parametrize("severities, expected", [
    (["low"], "low"),
    (["medium", "high", "medium"], "high"),
    (["critical", "low"], "critical"),          # conflicting: warn at the higher level
])
def test_event_severity_is_the_highest(severities, expected):
    assert policy.event_severity(severities) == expected


# ── review reason: flags an event for OPTIONAL review (None = nothing to flag) ──

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
    ({"tier": 0, "official_match": False}, "draft_alert"),   # single reports reach people who opted in
    ({"tier": 1, "official_match": False}, "draft_alert"),
    ({"tier": 2, "official_match": True}, END),              # the official warning already says it
])
def test_route_by_tier(state, expected):
    # No human_review branch: nothing waits for a reviewer. State keys and node names are
    # suggestions; rename here if yours differ. DECISION: an official match ends the run
    # (the report just joins the official event) instead of drafting a second alert.
    assert policy.route_by_tier(state) == expected
