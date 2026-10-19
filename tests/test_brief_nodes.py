"""The brief graph's nodes (docs/situation-brief-plan.md)."""
import asyncio

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END

from moby.ai import budget
from moby.graph import brief_nodes, brief_queries as bq
from moby.graph.brief_pipeline import build_brief_graph
from moby.graph.brief_policy import route_after_draft, route_after_evidence
from moby.graph.brief_writer import brief_message
from moby.graph.schemas import BriefDraft
from moby.graph.brief_nodes import gather_evidence

from .test_brief_queries import make_event
from .test_graph_queries import conn, db_url, fuse_one, seeded  # noqa: F401 (fixtures)


def test_community_event_has_only_community_evidence(conn):  # noqa: F811
    reports = seeded(conn, "corroborated_flood")
    eid = fuse_one(conn, reports[0])
    for r in reports[1:]:
        fuse_one(conn, r)
    out = gather_evidence({"event_id": eid})
    ids = [e["id"] for e in out["evidence"]]
    assert ids and all(i.startswith("C") for i in ids) and ids[0] == "C1"   # no O1: nobody official said anything
    assert all(e["kind"] == "community" and e["text"] for e in out["evidence"])
    assert out["facts"]["reporters"] == 3 and out["previous"] is None


def test_official_event_starts_with_o1(conn):  # noqa: F811
    eid = make_event(conn)
    conn.execute("UPDATE events SET source = 'official', source_feed = 'noaa', external_id = 'x', "
                 "title = 'Flood Warning', description = 'River rising fast.' WHERE event_id = %s", (eid,))
    out = gather_evidence({"event_id": eid})
    first = out["evidence"][0]
    assert first["id"] == "O1" and first["kind"] == "official"
    assert first["title"] == "Flood Warning · National Weather Service" and "River rising fast." in first["text"]
    assert [e["id"] for e in out["evidence"][1:]] == ["C1"]


def test_a_deleted_event_has_no_evidence(conn):  # noqa: F811
    assert gather_evidence({"event_id": "00000000-0000-0000-0000-000000000000"}) == {"evidence": []}


# ── The whole brief graph, with a fake Ultra (no model calls in tests) ───────────

FAKE = BriefDraft(reasoning="r", summary="People nearby report rising water.", uncertainty="Unverified.",
                  claims=[{"text": "Rising water reported.", "basis": "community", "evidence": ["C1"]}])


def test_routing():
    assert route_after_evidence({"evidence": []}) == END and route_after_evidence({"evidence": [{}]}) == "write_brief"
    assert route_after_draft({"draft": {}}) == END and route_after_draft({"draft": {"summary": "s"}}) == "save_brief"


def test_message_numbers_the_evidence():
    msg = brief_message([{"id": "C1", "kind": "community", "title": "Rising water · 2 people", "text": "2 people…"}],
                        hazard="flood", official=False)
    assert "Hazard: flood" in msg and "no official warning" in msg and "[C1] (community) Rising water" in msg


def run_brief(conn, monkeypatch, eid):  # noqa: F811
    calls = []

    async def fake_write_draft(evidence, *, hazard, official):
        calls.append(evidence)
        return FAKE
    monkeypatch.setattr(brief_nodes, "write_draft", fake_write_draft)
    conn.execute("TRUNCATE ai_usage")
    bq.request_brief(conn, eid)
    (ev,) = bq.claim_brief_events(conn, "w", limit=5)
    graph = build_brief_graph(InMemorySaver())
    config = {"configurable": {"thread_id": f"brief-{eid}-{ev['brief_requested_at']}"}}
    asyncio.run(graph.ainvoke({"event_id": eid, "requested_at": ev["brief_requested_at"]}, config))
    return calls


def test_graph_writes_and_saves_a_brief(conn, monkeypatch):  # noqa: F811
    reports = seeded(conn, "corroborated_flood")
    eid = fuse_one(conn, reports[0])
    for r in reports[1:]:
        fuse_one(conn, r)
    calls = run_brief(conn, monkeypatch, eid)
    assert len(calls) == 1 and calls[0][0]["id"] == "C1"
    status, summary, citations = conn.execute(
        "SELECT e.brief_status, b.summary, b.citations FROM events e JOIN briefs b USING (event_id)").fetchone()
    assert status == "ready" and summary == FAKE.summary and citations[0]["id"] == "C1"


def test_over_the_cap_no_model_call_nothing_saved(conn, monkeypatch):  # noqa: F811
    eid = make_event(conn)
    monkeypatch.setenv("MOBY_DAILY_CAP_BRIEF", "0")
    assert budget.cap("brief") == 0
    assert run_brief(conn, monkeypatch, eid) == []
    assert conn.execute("SELECT count(*) FROM briefs").fetchone()[0] == 0
