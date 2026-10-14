"""The developer helpers: scripts/seed_reports.py and `python -m moby.graph.run`.

Uses a tiny stand-in graph (not the real fusion graph) so the harness is proven before
the graph exists. Needs the throwaway test database.
"""
import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from typing import TypedDict

import psycopg
import pytest
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from moby.graph import run as harness

from .test_chains_and_preferences import _test_db_url

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("seed_reports", ROOT / "scripts" / "seed_reports.py")
seed_reports = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_reports)


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


@pytest.fixture
def db(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events, reports CASCADE")
    return db_url


def count(db_url, sql):
    with psycopg.connect(db_url) as c:
        return c.execute(sql).fetchone()[0]


def test_seed_every_scenario_and_reset(db):
    assert seed_reports.main(["all"]) == 0
    expected = sum(len(s.reports) for s in seed_reports.SCENARIOS.values())
    assert count(db, "SELECT count(*) FROM reports WHERE fusion_status = 'pending'") == expected
    # repeats from one person: three reports, one reporter
    assert count(db, "SELECT count(DISTINCT reporter_hash) FROM reports WHERE client_event_id LIKE 'seed-same_person%'") == 1
    assert count(db, "SELECT count(*) FROM events WHERE source = 'official' AND external_id LIKE 'seed-%'") == 1
    assert count(db, "SELECT cardinality(relayed_by) FROM reports WHERE source = 'mesh'") == 2
    assert seed_reports.main(["--reset"]) == 0
    assert count(db, "SELECT count(*) FROM reports") == 0
    assert count(db, "SELECT count(*) FROM events") == 0


def test_seed_rejects_unknown_scenario(db):
    with pytest.raises(SystemExit):
        seed_reports.main(["no_such_scenario"])


# ── harness, with a stand-in graph ───────────────────────────────────────────

class S(TypedDict, total=False):
    report: dict
    tier: int
    reviewer_decision: str


def build_stub(checkpointer):
    """score → (critical) review [interrupt] → done."""
    def score(state):
        return {"tier": 1 if state["report"]["severity"] == "critical" else 0}

    def review(state):
        return {"reviewer_decision": interrupt({"reason": "severity_floor", "tier": state["tier"]})}

    g = StateGraph(S)
    g.add_node("score", score)
    g.add_node("review", review)
    g.add_edge(START, "score")
    g.add_conditional_edges("score", lambda s: "review" if s["tier"] == 1 else END, ["review", END])
    g.add_edge("review", END)
    return g.compile(checkpointer=checkpointer)


@pytest.fixture
def stub_module(monkeypatch):
    mod = types.ModuleType("stub_graph")
    mod.build_graph = build_stub
    monkeypatch.setitem(sys.modules, "stub_graph", mod)
    return "stub_graph:build_graph"


def test_fetch_report_gives_lat_lon_and_plain_values(db):
    seed_reports.main(["critical_single"])
    r = harness.fetch_report(None)
    assert r["severity"] == "critical" and r["fusion_status"] == "pending"
    assert isinstance(r["lat"], float) and isinstance(r["report_id"], str)
    assert harness.fetch_report(r["report_id"])["report_id"] == r["report_id"]


def test_once_prints_the_path(db, stub_module, capsys):
    seed_reports.main(["lone_low"])
    assert harness.main(["--once", "--graph", stub_module, "--show-state"]) == 0
    out = capsys.readouterr().out
    assert "→ score: tier=0" in out and "paused" not in out


def test_once_shows_an_interrupt(db, stub_module, capsys):
    seed_reports.main(["critical_single"])
    assert harness.main(["--once", "--graph", stub_module]) == 0
    out = capsys.readouterr().out
    assert "→ score: tier=1" in out and "⏸  paused" in out and "severity_floor" in out


def test_resume_continues_a_paused_run():
    # In one process, with one in-memory checkpointer (what --postgres gives you across processes).
    from langgraph.checkpoint.memory import InMemorySaver
    saver = InMemorySaver()

    async def go():
        cfg = {"configurable": {"thread_id": "report-x"}}
        graph = build_stub(saver)
        await graph.ainvoke({"report": {"severity": "critical"}}, cfg)
        assert (await graph.aget_state(cfg)).next == ("review",)          # paused before finishing review
        return await harness.run(lambda _: graph, state=None, thread_id="report-x", resume="approve")

    assert asyncio.run(go())["reviewer_decision"] == "approve"


def test_missing_graph_module_explains_what_to_create(db):
    with pytest.raises(SystemExit) as e:
        harness.load_builder("moby.graph.does_not_exist:build_graph")
    assert "build_graph(checkpointer)" in str(e.value)
