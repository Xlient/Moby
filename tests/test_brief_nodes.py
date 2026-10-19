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
    assert out["facts"]["place"] is None and "raw_payload" not in out["facts"]   # no areaDesc in this test row
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
    assert route_after_evidence({"evidence": []}) == END and route_after_evidence({"evidence": [{}]}) == "research"
    assert route_after_draft({"draft": {}}) == END and route_after_draft({"draft": {"summary": "s"}}) == "save_brief"


def test_message_numbers_the_evidence():
    msg = brief_message([{"id": "C1", "kind": "community", "title": "Rising water · 2 people", "text": "2 people…"}],
                        hazard="flood", official=False)
    assert "Hazard: flood" in msg and "no official warning" in msg and "[C1] (community) Rising water" in msg


def run_brief(conn, monkeypatch, eid):  # noqa: F811
    calls = []

    async def fake_write_draft(evidence, *, hazard, official, searched_web=True):
        calls.append(evidence)
        return FAKE

    async def fake_search_web(facts, *, calls):
        return [{"kind": "official", "title": "Flood safety · weather.gov", "text": "Turn around.",
                 "url": "https://www.weather.gov/safety/flood"}]
    monkeypatch.setattr(brief_nodes, "write_draft", fake_write_draft)
    monkeypatch.setattr(brief_nodes, "search_web", fake_search_web)      # never the real Tavily in tests
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
    # A community event has no place name to search for: no web sources.
    assert len(calls) == 1 and all(e["id"].startswith("C") for e in calls[0])
    status, summary, citations = conn.execute(
        "SELECT e.brief_status, b.summary, b.citations FROM events e JOIN briefs b USING (event_id)").fetchone()
    assert status == "ready" and summary == FAKE.summary and all(c["kind"] == "community" for c in citations)


def test_an_official_warning_gets_web_sources(conn, monkeypatch):  # noqa: F811
    eid = make_event(conn)
    conn.execute("""UPDATE events SET source = 'official', source_feed = 'noaa', external_id = 'w',
                    title = 'Flood Warning', raw_payload = '{"properties": {"areaDesc": "Sonoma"}}'""")
    calls = run_brief(conn, monkeypatch, eid)
    assert [e["id"] for e in calls[0]] == ["O1", "C1", "W1"]
    (citations,) = conn.execute("SELECT citations FROM briefs").fetchone()
    assert citations[-1] == {"id": "W1", "title": "Flood safety · weather.gov", "kind": "official",
                             "url": "https://www.weather.gov/safety/flood"}


def test_over_the_cap_no_model_call_nothing_saved(conn, monkeypatch):  # noqa: F811
    eid = make_event(conn)
    monkeypatch.setenv("MOBY_DAILY_CAP_BRIEF", "0")
    assert budget.cap("brief") == 0
    assert run_brief(conn, monkeypatch, eid) == []
    assert conn.execute("SELECT count(*) FROM briefs").fetchone()[0] == 0



# ── research: the web is optional, so it never fails a brief ─────────────────────

FACTS = {"hazard_type": "flood", "product": None, "place": "Sonoma", "country": "US"}
EVIDENCE = [{"id": "C1", "kind": "community", "title": "t", "text": "x"}]


def research_with(monkeypatch, *, facts=FACTS, granted=3, found=None, error=None):
    asked = {}

    async def fake_search_web(f, *, calls):
        asked["calls"] = calls
        if error:
            raise error
        return found or []
    monkeypatch.setattr(brief_nodes, "search_web", fake_search_web)
    monkeypatch.setattr(brief_nodes, "_take_tavily_budget", lambda units: granted)
    out = asyncio.run(brief_nodes.research({"event_id": "e", "facts": facts, "evidence": EVIDENCE}))
    return out, asked


def test_research_numbers_web_sources_after_the_rest(monkeypatch):
    found = [{"kind": "official", "title": "a", "text": "1", "url": "https://weather.gov/a"},
             {"kind": "news", "title": "b", "text": "2", "url": "https://reuters.com/b"}]
    out, asked = research_with(monkeypatch, found=found)
    assert asked["calls"] == ["official", "news"]
    assert [e["id"] for e in out["evidence"]] == ["C1", "W1", "W2"] and out["web"][1]["kind"] == "news"


def test_research_without_country_budget_or_luck_adds_nothing(monkeypatch):
    assert research_with(monkeypatch, facts={**FACTS, "country": None})[0] == {"web": []}
    assert research_with(monkeypatch, facts={**FACTS, "place": None})[0] == {"web": []}   # "flood US" is too vague
    out, asked = research_with(monkeypatch, granted=0)
    assert out == {"web": []} and "calls" not in asked                       # no Tavily call at all
    assert research_with(monkeypatch, error=RuntimeError("down"))[0] == {"web": []}


def test_research_with_a_partial_budget_searches_official_sites_first(monkeypatch):
    assert research_with(monkeypatch, granted=1)[1]["calls"] == ["official"]
    # A country without an official-domain list: news first.
    assert research_with(monkeypatch, granted=1, facts={**FACTS, "country": "HK"})[1]["calls"] == ["news"]


def test_long_official_text_is_cut_at_a_sentence():
    text = brief_nodes._cut("First sentence. " * 300, 4000)
    assert len(text) <= 4000 + 4 and text.endswith(". […]")
    assert brief_nodes._cut("short", 4000) == "short"
