"""brief_checks (Step 5) and brief_changes (Step 6): pure functions, no model, no database."""
import asyncio

from moby.graph import brief_changes as bc
from moby.graph.brief_checks import claim_problems, draft_problems, repair
from moby.graph.brief_policy import route_after_check

EVIDENCE = [
    {"id": "O1", "kind": "official", "title": "Flood Warning · NWS", "text": "2 to 4 feet of inundation until 5:00 PM."},
    {"id": "C1", "kind": "community", "title": "Rising water · 3 people", "text": "3 people saw rising water."},
    {"id": "W1", "kind": "official", "title": "Bulletin · darenc.gov", "text": "Mandatory evacuation for visitors."},
    {"id": "W2", "kind": "news", "title": "Flood · reuters.com", "text": "Roads closed, Reuters reports."},
]


def claim(text, basis, *ids):
    return {"text": text, "basis": basis, "evidence": list(ids)}


def test_good_claims_pass():
    for c in [claim("2 to 4 feet of inundation are expected.", "official", "O1"),
              claim("A mandatory evacuation applies to visitors.", "official", "W1"),
              claim("3 people nearby report rising water.", "community", "C1"),
              claim("Reuters reports roads are closed.", "news", "W2")]:
        assert claim_problems(c, EVIDENCE) == [], c


def test_made_up_ids_wrong_basis_and_stray_numbers():
    assert "isn't in the evidence" in claim_problems(claim("x", "official", "O9"), EVIDENCE)[0]
    assert "marked official but cites C1 (community)" in claim_problems(claim("x", "official", "C1"), EVIDENCE)[0]
    assert "marked official but cites W2 (news)" in claim_problems(claim("x", "official", "W2"), EVIDENCE)[0]
    stray = claim_problems(claim("About 6 more hours of 2 to 4 feet.", "official", "O1"), EVIDENCE)
    assert len(stray) == 1 and ": 6." in stray[0]                        # calculated, not in the evidence


def test_guidance_needs_official_evidence():
    only_community = [EVIDENCE[1]]
    draft = {"summary": "s", "claims": [claim("3 people saw rising water.", "community", "C1")],
             "official_guidance": "Move to higher ground."}
    assert draft_problems(draft, only_community) == [
        "official_guidance is set, but there is no official evidence (no O item or official W item)."]
    assert repair(draft, only_community)["official_guidance"] is None


def test_repair_keeps_what_passes_and_rebuilds_a_bad_summary():
    draft = {"summary": "12 feet of water.", "claims": [claim("2 to 4 feet expected.", "official", "O1"),
                                                         claim("Officials confirm it.", "official", "C1")]}
    fixed = repair(draft, EVIDENCE)
    assert [c["text"] for c in fixed["claims"]] == ["2 to 4 feet expected."]
    assert fixed["summary"] == "2 to 4 feet expected."
    assert repair({"summary": "s", "claims": [claim("x", "official", "C1")]}, EVIDENCE) is None


def test_route_after_check_ends_the_loop():
    assert route_after_check({"problems": []}) == "explain_changes"
    assert route_after_check({"problems": ["p"], "attempts": 1}) == "write_brief"
    assert route_after_check({"problems": ["p"], "attempts": 2}) == "repair_brief"


# ── what changed ──────────────────────────────────────────────────────────────────

OLD = {"source": "official", "severity": "high", "product": "Flood Warning", "expires_at": "2026-10-20 17:00:00+00",
       "area_km2": 100.0, "reporters": 2, "description": "a"}


def test_diff_finds_what_matters():
    new = {**OLD, "severity": "critical", "expires_at": "2026-10-21 05:00:00+00", "area_km2": 130.0,
           "reporters": 5, "description": "b", "evidence_as_of": "later"}
    types = [c["type"] for c in bc.diff_facts(OLD, new)]
    assert types == ["severity", "expires", "area", "reporters", "wording"]
    assert bc.diff_facts(OLD, {**OLD, "area_km2": 105.0, "evidence_as_of": "x"}) == []   # <10%, timestamps ignored


def test_describe_is_plain_and_keeps_unverified():
    text = bc.describe(bc.diff_facts(OLD, {**OLD, "severity": "critical", "reporters": 5}))
    assert text == "Severity raised from high to critical. 3 more people nearby reported it, unverified (5 in all)."


def test_super_adding_a_number_falls_back_to_plain(monkeypatch):
    changes = bc.diff_facts(OLD, {**OLD, "reporters": 5})

    class FakeLLM:
        def __init__(self, reply):
            self.reply = reply

        async def ainvoke(self, prompt):
            return type("R", (), {"content": self.reply})()
    monkeypatch.setattr(bc, "chat_model", lambda *a, **k: FakeLLM("<think>hm</think>Three more people reported it."))
    assert asyncio.run(bc.write_changes(changes)) == "Three more people reported it."
    monkeypatch.setattr(bc, "chat_model", lambda *a, **k: FakeLLM("12 more people reported it."))
    assert asyncio.run(bc.write_changes(changes)) == bc.describe(changes)
