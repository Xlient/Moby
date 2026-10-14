"""Offline guidance (migration 0008): grounding checks, draft → review → publish, public routes."""
from datetime import datetime, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.config import get_settings
from moby.jobs.guidance import _cited, cards_for, grounding_problem, page_text, Source

from .test_chains_and_preferences import _test_db_url

TOKEN = "test-service-token"


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


@pytest.fixture
def client(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")     # caller is a reviewer
    monkeypatch.setenv("MOBY_SERVICE_TOKEN", TOKEN)
    get_settings.cache_clear()
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE guidance_bundles CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def card(card_id="flood-ready-turn-around", **kw):
    return {"card_id": card_id, "hazard_type": "flood", "title": "Turn around, don't drown",
            "body": "Do not walk, swim or drive through flood waters.", "priority": 10,
            "source_name": "FEMA Ready.gov", "source_url": "https://www.ready.gov/floods",
            "last_reviewed_at": datetime.now(timezone.utc).isoformat(), "is_critical_fallback": True,
            "evidence": ["Do not walk, swim or drive through flood waters."], **kw}


def store(client, cards):
    return client.post("/internal/v1/guidance/bundles", headers={"Authorization": f"Bearer {TOKEN}"},
                       json={"region": "US", "model": "test-ultra", "cards": cards})


# ── Grounding ────────────────────────────────────────────────────────

PAGE = page_text("""<html><nav>Menu Home</nav><main>
<h2>If you are under a flood warning</h2>
<ul><li>Find safe shelter right away.</li>
<li>Do not walk, swim or drive through flood waters. Turn Around, Don’t Drown!</li>
<li>Remember, just six inches of moving water can knock you down, and one foot of moving water can sweep your vehicle away.</li>
<li>Stay off bridges over 12 fast-moving water.</li></ul></main><footer>Contact us</footer></html>""")


def test_page_text_drops_chrome():
    assert "Menu" not in PAGE and "Contact us" not in PAGE and PAGE.startswith("If you are under a flood warning")


def test_cited_lines_are_verbatim_and_validated():
    lines = PAGE.split("\n")
    assert _cited(["L2", "3", 3, 99, "x"], lines) == [lines[1], lines[2]]
    assert _cited("L2", lines) == [lines[1]]


def test_grounding_rejects_invented_advice_and_numbers():
    lines = PAGE.split("\n")
    ok = {"title": "Under a flood warning", "body": "Find safe shelter right away. Do not walk, swim or drive "
          "through flood waters. Turn around, don't drown."}
    assert grounding_problem(ok, lines[1:3]) is None
    assert "cites no valid" in grounding_problem(ok, [])
    invented = {"title": "Under a flood warning", "body": "Fill the bathtub, tape the windows and call your insurer."}
    assert "words are in the cited lines" in grounding_problem(invented, lines[1:3])
    bad_number = {"title": "Bridges", "body": "Stay off bridges over 15 fast-moving water."}
    assert "numbers not in" in grounding_problem(bad_number, [lines[4]])


class FakeLLM:
    def __init__(self, content):
        self.content = content

    def invoke(self, _):
        return self


def test_cards_for_keeps_grounded_and_drops_the_rest():
    src = Source("flood", "FEMA Ready.gov", "https://www.ready.gov/floods")
    out = """```json
    [{"slug": "Under Warning!", "title": "Under a flood warning", "body": "Find safe shelter right away. Do not walk, swim or drive through flood waters.", "lines": ["L2", "L3"], "priority": "10", "is_critical_fallback": true},
     {"slug": "made-up", "title": "Prepare", "body": "Buy sandbags and move valuables upstairs today.", "lines": [2]}]
    ```"""
    kept, dropped = cards_for(src, PAGE, FakeLLM(out), "2026-10-04T00:00:00+00:00")
    assert [c["card_id"] for c in kept] == ["flood-ready-under-warning"]
    assert kept[0]["priority"] == 10 and kept[0]["is_critical_fallback"] is True
    assert kept[0]["evidence"] == PAGE.split("\n")[1:3]
    assert len(dropped) == 1 and "made-up" in dropped[0]


def test_unusable_model_output_drops_everything():
    kept, dropped = cards_for(Source("flood", "x", "https://x.gov"), PAGE, FakeLLM("I can't help"), "2026-10-04")
    assert kept == [] and "unusable" in dropped[0]


# ── Draft → review → publish ─────────────────────────────────────────

def test_nothing_is_public_until_published(client):
    assert store(client, [card()]).status_code == 201
    assert client.get("/v1/guidance/manifest").json() == {"bundles": []}
    assert client.get("/v1/guidance/cards?region=US").json()["cards"] == []


def test_internal_route_needs_the_service_token(client):
    r = client.post("/internal/v1/guidance/bundles", json={"region": "US", "model": "m", "cards": [card()]})
    assert r.status_code in (401, 403)


def test_review_drop_publish_and_serve(client):
    b = store(client, [card(), card("flood-ready-after", title="After a flood", is_critical_fallback=False,
                                     priority=40)]).json()
    detail = client.get(f"/v1/review/guidance/{b['bundle_id']}").json()
    assert detail["status"] == "draft" and detail["cards"][0]["evidence"]
    assert client.delete(f"/v1/review/guidance/{b['bundle_id']}/cards/flood-ready-after").status_code == 204
    assert client.post(f"/v1/review/guidance/{b['bundle_id']}/publish").status_code == 204
    assert client.post(f"/v1/review/guidance/{b['bundle_id']}/publish").status_code == 409

    (bundle,) = client.get("/v1/guidance/manifest?region=US").json()["bundles"]
    assert bundle["card_count"] == 1 and bundle["hazard_types"] == ["flood"]
    body = client.get("/v1/guidance/cards?region=US").json()
    assert [c["card_id"] for c in body["cards"]] == ["flood-ready-turn-around"]
    assert "evidence" not in body["cards"][0] and body["content_hash"] == bundle["content_hash"]
    assert client.get("/v1/guidance/cards?region=US&hazard_type=fire").json()["cards"] == []
    assert client.get("/v1/guidance/cards?region=US&bundle_version=old").status_code == 409
    # Published bundles are frozen.
    assert client.delete(f"/v1/review/guidance/{b['bundle_id']}/cards/flood-ready-turn-around").status_code == 409


def test_publishing_a_new_version_retires_the_old_one(client):
    first = store(client, [card()]).json()
    client.post(f"/v1/review/guidance/{first['bundle_id']}/publish")
    second = store(client, [card(), card("flood-ready-more", title="More")]).json()
    assert second["version"] != first["version"]
    client.post(f"/v1/review/guidance/{second['bundle_id']}/publish")
    (live,) = client.get("/v1/guidance/manifest").json()["bundles"]
    assert live["version"] == second["version"] and live["card_count"] == 2


def test_bundle_validation(client):
    assert store(client, [card(), card()]).status_code == 422                       # duplicate ids
    assert store(client, [card(source_url="http://insecure.example")]).status_code == 422
    assert store(client, [card(evidence=[])]).status_code == 422
