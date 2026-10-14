"""'What this means for you': the grounding checks decide what users see, so test them hard."""
import asyncio

from moby.ai import explain
from moby.ai.grounding import numbers, stray_numbers, support

WARNING = (
    "The National Weather Service has issued a Flood Warning for the Russian River at Guerneville. "
    "The river is expected to rise above flood stage of 32 feet, flooding low-lying roads and homes "
    "near the river.\n\nInstructions: Turn around, don't drown when encountering flooded roads. "
    "Move to higher ground if water rises around you."
)


def test_numbers_normalise_decimal_commas():
    assert numbers("rain of 12,5 mm") == numbers("rain of 12.5 mm")
    assert not stray_numbers("about 32 feet", WARNING)
    assert list(stray_numbers("up to 40 feet", WARNING)) == ["40"]


def test_support_is_share_of_content_words_found_in_source():
    assert support("Move to higher ground", WARNING) == 1.0
    assert support("Evacuate by helicopter tonight", WARNING) < 0.5


def test_parse_strips_fences_and_caps_actions():
    raw = '```json\n{"summary": " Rivers rise. ", "actions": ["a", "", "b", "c", "d"]}\n```'
    assert explain.parse(raw) == {"summary": "Rivers rise.", "actions": ["a", "b", "c"]}


def test_check_accepts_a_grounded_explanation():
    out = {
        "summary": "The Russian River is expected to rise above flood stage, flooding low-lying roads and homes.",
        "actions": ["Turn around when encountering flooded roads.", "Move to higher ground if water rises."],
    }
    assert explain.check(out, "Flood Warning", WARNING) is None


def test_check_rejects_invented_numbers_and_actions():
    base = "The Russian River is expected to rise above flood stage, flooding roads near the river."
    assert "numbers" in explain.check({"summary": base + " Expect 6 inches of rain.", "actions": []}, "", WARNING)
    bad_action = {"summary": base, "actions": ["Fill sandbags and tape your windows."]}
    assert "action not in the warning" in explain.check(bad_action, "", WARNING)
    assert explain.check({"summary": "", "actions": []}, "", WARNING) == "summary empty or too long"


def test_source_text_appends_nws_instructions_but_prefers_translation():
    row = {"title": "Flood Warning", "description": "River rising.",
           "raw_payload": {"properties": {"instruction": "Move to higher ground."}}}
    assert explain.source_text(row)[1].endswith("Instructions: Move to higher ground.")
    row |= {"translation_status": "done", "title_en": "Typhoon warning", "description_en": "Winds are strong."}
    assert explain.source_text(row) == ("Typhoon warning", "Winds are strong.")


class FakeLLM:
    def __init__(self, content):
        self.content = content

    async def ainvoke(self, _msg):
        if isinstance(self.content, Exception):
            raise self.content
        return type("Resp", (), {"content": self.content})()


ROW = {"hazard_type": "flood", "severity": "severe", "title": "Flood Warning", "description": WARNING,
       "raw_payload": {}}


def test_explain_one_returns_nothing_when_the_model_fails_or_strays():
    good = '{"summary": "The Russian River is expected to rise above flood stage, flooding roads.", "actions": []}'
    out, problem = asyncio.run(explain.explain_one(FakeLLM(good), ROW))
    assert problem is None and out["summary"].startswith("The Russian River")

    out, problem = asyncio.run(explain.explain_one(FakeLLM("not json"), ROW))
    assert out is None and "JSONDecodeError" in problem

    out, problem = asyncio.run(explain.explain_one(FakeLLM(TimeoutError("slow")), ROW))
    assert out is None and "TimeoutError" in problem

    out, problem = asyncio.run(explain.explain_one(FakeLLM(good), ROW | {"description": "Short."}))
    assert out is None and "too little" in problem


# ── The route: generated on first view, cached per event ─────────────

import uuid  # noqa: E402

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from moby.config import get_settings  # noqa: E402

from .test_chains_and_preferences import _test_db_url  # noqa: E402


@pytest.fixture
def client_db(monkeypatch):
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")
    get_settings.cache_clear()
    from moby.api.app import app
    with TestClient(app) as c:
        yield c, url
    get_settings.cache_clear()


def add_event(url, *, source="official", description=WARNING):
    with psycopg.connect(url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, title, description, "
            "location) VALUES (%s, %s, %s, 'flood', 'high', 2, 'Flood Warning', %s, "
            "ST_SetSRID(ST_MakePoint(-123.0, 38.5), 4326)::geography) RETURNING event_id",
            (source, "noaa" if source == "official" else None, str(uuid.uuid4()) if source == "official" else None,
             description)).fetchone()
    return eid


def test_route_queues_on_first_view_then_serves_the_cached_explanation(client_db):
    client, url = client_db
    eid = add_event(url)
    first = client.get(f"/v1/events/{eid}/explain")
    assert first.status_code == 202 and first.json()["status"] == "pending"

    with psycopg.connect(url, autocommit=True) as c:
        status = c.execute("SELECT explainer_status FROM events WHERE event_id = %s", (eid,)).fetchone()[0]
        assert status == "pending"
        c.execute("UPDATE events SET explainer = %s::jsonb, explainer_status = 'done' WHERE event_id = %s",
                  ('{"summary": "The river is rising.", "actions": [], "model": "m", '
                   '"generated_at": "2026-10-14T00:00:00Z"}', eid))
    done = client.get(f"/v1/events/{eid}/explain")
    assert done.status_code == 200
    assert done.json()["summary"] == "The river is rising." and done.json()["event_id"] == str(eid)


def test_route_never_explains_community_reports_or_short_text(client_db):
    client, url = client_db
    assert client.get(f"/v1/events/{add_event(url, source='manual')}/explain").status_code == 404
    assert client.get(f"/v1/events/{add_event(url, description='Short.')}/explain").status_code == 404
    assert client.get(f"/v1/events/{uuid.uuid4()}/explain").status_code == 404
