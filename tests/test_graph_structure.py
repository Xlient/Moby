"""Spec for step 7: Nano reads the report's note (structure_report). Never calls a real model.

Skipped until moby/graph/structure.py exists. The contract:

  * moby/graph/structure.py: `extract_details(report: dict) -> ReportDetails`
      - the model call only: prompt + chat_model("nano", temperature=0).with_structured_output(ReportDetails)
      - raises if the model fails (the node handles it)
      - imports `chat_model` at module level (`from moby.llm import chat_model`) so tests can replace it
  * moby/graph/nodes.py: `structured_report(state) -> {"structured": dict}`
      - no note → {} and no model call
      - claims one unit of the "structure" daily cap first (budget.take_sync); over the cap → {}
      - success → ReportDetails.to_saved() in the state AND saved with queries.save_structured
      - any failure (model error, invalid output, timeout) → {}: the report still gets fused

Whether Nano gets the examples RIGHT is a real-model question: scripts/eval_structure.py.
"""
import asyncio
import json
from pathlib import Path

import pytest

from moby.config import get_settings
from moby.graph import run as harness
from moby.graph.db import close_pools
from moby.graph.schemas import ReportDetails

from .test_graph_queries import conn, db_url, seeded  # noqa: F401 (fixtures)

structure = pytest.importorskip("moby.graph.structure", reason="moby/graph/structure.py not written yet")
from moby.graph import nodes  # noqa: E402

EXAMPLES = json.loads((Path(__file__).parent / "fixtures" / "structure_examples.json").read_text())


class FakeNano:
    """Stands in for chat_model("nano"): answers each note with a scripted ReportDetails (or raises)."""

    def __init__(self, answers: dict):
        self.answers, self.calls, self.created_with = answers, [], None

    def __call__(self, tier, **kwargs):                       # replaces chat_model(tier, **kwargs)
        self.created_with = (tier, kwargs)
        return self

    def with_structured_output(self, schema, **kwargs):
        assert schema is ReportDetails
        return self

    def invoke(self, messages, *args, **kwargs):
        text = str(messages)
        self.calls.append(text)
        for note, answer in self.answers.items():
            if note in text:
                if isinstance(answer, Exception):
                    raise answer
                return answer
        raise AssertionError("the note wasn't in the prompt")


@pytest.fixture(autouse=True)
def settings(db_url, monkeypatch):  # noqa: F811
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.delenv("MOBY_DAILY_CAP_STRUCTURE", raising=False)
    get_settings.cache_clear()
    with __import__("psycopg").connect(db_url, autocommit=True) as c:
        c.execute("DELETE FROM ai_usage")
    yield
    close_pools()
    get_settings.cache_clear()


def fake(monkeypatch, answers) -> FakeNano:
    model = FakeNano(answers)
    monkeypatch.setattr(structure, "chat_model", model)
    return model


def with_note_report(conn, note: str) -> dict:  # noqa: F811
    (report,) = seeded(conn, "lone_low")
    conn.execute("UPDATE reports SET note = %s WHERE report_id = %s", (note, report["report_id"]))
    return harness.fetch_report(report["report_id"])


def saved(conn, report_id):  # noqa: F811
    return conn.execute("SELECT structured FROM reports WHERE report_id = %s", (report_id,)).fetchone()[0]


@pytest.mark.parametrize("example", EXAMPLES, ids=[e["name"] for e in EXAMPLES])
def test_details_are_saved_without_the_reasoning(conn, monkeypatch, example):  # noqa: F811
    note = example["report"]["note"]
    answer = ReportDetails(reasoning="free text that may echo the note", **example["expected"])
    model = fake(monkeypatch, {note: answer})
    report = with_note_report(conn, note)

    out = nodes.structured_report({"report": report})
    assert out == {"structured": example["expected"]}
    assert saved(conn, report["report_id"]) == example["expected"]          # 'reasoning' never stored
    tier, kwargs = model.created_with
    assert tier == "nano" and kwargs["temperature"] == 0 and kwargs.get("timeout")   # a hung call must give up
    assert len(model.calls) == 1


def test_the_prompt_contains_the_note_and_the_form_answers(monkeypatch):
    ex = EXAMPLES[3]                                                        # the Winston fire
    model = fake(monkeypatch, {ex["report"]["note"]: ReportDetails(reasoning="-", **ex["expected"])})
    assert structure.extract_details(ex["report"]).people_trapped == 3
    prompt = model.calls[0]
    assert "fire" in prompt and "medium" in prompt                          # the form's answers give context


def test_no_note_means_no_model_call(conn, monkeypatch):  # noqa: F811
    model = fake(monkeypatch, {})
    (report,) = seeded(conn, "lone_low")                                    # its note is empty
    assert nodes.structured_report({"report": report}) == {"structured": {}}
    assert model.calls == [] and saved(conn, report["report_id"]) is None


@pytest.mark.parametrize("failure", [TimeoutError("model timed out"), ValueError("not valid JSON for the schema")])
def test_a_model_failure_never_stops_the_report(conn, monkeypatch, failure):  # noqa: F811
    note = EXAMPLES[0]["report"]["note"]
    fake(monkeypatch, {note: failure})
    report = with_note_report(conn, note)
    assert nodes.structured_report({"report": report}) == {"structured": {}}
    # ...and the whole graph still fuses it into an event.
    from moby.graph.pipeline import build_graph
    asyncio.run(harness.run(build_graph, state={"report": report}, thread_id=f"report-{report['report_id']}"))
    assert conn.execute("SELECT fusion_status FROM reports WHERE report_id = %s",
                        (report["report_id"],)).fetchone()[0] == "fused"


def test_each_note_uses_one_unit_of_the_daily_cap(conn, monkeypatch):  # noqa: F811
    ex = EXAMPLES[1]
    fake(monkeypatch, {ex["report"]["note"]: ReportDetails(reasoning="-", **ex["expected"])})
    nodes.structured_report({"report": with_note_report(conn, ex["report"]["note"])})
    assert conn.execute("SELECT used FROM ai_usage WHERE feature = 'structure'").fetchone()[0] == 1


def test_over_the_daily_cap_the_model_is_not_called(conn, monkeypatch):  # noqa: F811
    monkeypatch.setenv("MOBY_DAILY_CAP_STRUCTURE", "0")
    model = fake(monkeypatch, {})
    report = with_note_report(conn, EXAMPLES[2]["report"]["note"])
    assert nodes.structured_report({"report": report}) == {"structured": {}}
    assert model.calls == []
