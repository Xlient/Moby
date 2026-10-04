"""Reviewer routes over review_queue (migration 0006). Uses the throwaway test DB."""
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from moby.api import auth as auth_module
from moby.config import get_settings

from .test_chains_and_preferences import _test_db_url


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


@pytest.fixture
def client(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")
    get_settings.cache_clear()
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events, reports, review_queue CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    get_settings.cache_clear()


def seed(db_url, *, reason: str, minutes_ago: int, reports: int = 2) -> str:
    """An event the pipeline has paused for review, with contributing reports."""
    with psycopg.connect(db_url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, hazard_type, severity, location, tier, confidence, distinct_reporter_count) "
            "VALUES ('manual', 'flood', 'high', ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, 1, 0.6, %s) "
            "RETURNING event_id", (reports,)).fetchone()
        for i in range(reports):
            c.execute(
                "INSERT INTO reports (client_event_id, event_id, fusion_status, reporter_hash, hazard_type, "
                "observed_effect, severity, location, observed_at, note) VALUES "
                "(%s, %s, 'fused', %s, 'flood', 'rising_water', 'high', "
                "ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, now() - interval '5 minutes', %s)",
                (str(uuid.uuid4()), eid, f"reporter{i:028d}", f"note {i}"))
        c.execute("INSERT INTO review_queue (event_id, reason, queued_at, adjudicator_rationale, graph_thread_id) "
                  "VALUES (%s, %s, %s, 'Two reports 40 m apart; no official match', 'thread-1')",
                  (eid, reason, datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)))
    return str(eid)


def test_queue_lists_open_items_severity_floor_first(client, db_url):
    older = seed(db_url, reason="tier1_corroborated", minutes_ago=30)
    floor = seed(db_url, reason="severity_floor", minutes_ago=1, reports=1)
    items = client.get("/v1/review/queue").json()
    assert [i["event_id"] for i in items] == [floor, older]
    first = items[1]
    assert first["reason"] == "tier1_corroborated"
    assert first["event"]["hazard_type"] == "flood" and first["event"]["tier"] == 1
    assert len(first["contributing_reports"]) == 2
    assert first["contributing_reports"][0]["note"] == "note 0"
    assert len(first["contributing_reports"][0]["reporter"]) == 8          # short hash, never the id
    assert first["adjudicator_rationale"].startswith("Two reports")


def test_decision_is_recorded_once(client, db_url):
    eid = seed(db_url, reason="tier1_corroborated", minutes_ago=5)
    r = client.post(f"/v1/review/{eid}/decision", json={"decision": "approve", "note": "  Matches photos  "})
    assert r.status_code == 204
    with psycopg.connect(db_url) as c:
        row = c.execute("SELECT status, decision, decision_note, decided_by IS NOT NULL, decided_at IS NOT NULL "
                        "FROM review_queue WHERE event_id = %s", (eid,)).fetchone()
        (rd,) = c.execute("SELECT reviewer_decision FROM events WHERE event_id = %s", (eid,)).fetchone()
    assert row == ("decided", "approve", "Matches photos", True, True) and rd == "approve"
    assert client.get("/v1/review/queue").json() == []                     # no longer open
    assert client.post(f"/v1/review/{eid}/decision", json={"decision": "reject"}).status_code == 409


def test_override_severity_and_validation(client, db_url):
    eid = seed(db_url, reason="conflicting_reports", minutes_ago=5)
    assert client.post(f"/v1/review/{eid}/decision", json={"decision": "maybe"}).status_code == 422
    assert client.post(f"/v1/review/{eid}/decision", json={"decision": "hold", "note": "x" * 501}).status_code == 422
    assert client.post(f"/v1/review/{eid}/decision",
                       json={"decision": "approve", "override_severity": "critical"}).status_code == 204
    with psycopg.connect(db_url) as c:
        (sev,) = c.execute("SELECT override_severity FROM review_queue WHERE event_id = %s", (eid,)).fetchone()
    assert sev == "critical"


def test_unknown_event_is_404(client):
    assert client.post(f"/v1/review/{uuid.uuid4()}/decision", json={"decision": "approve"}).status_code == 404


def test_non_reviewers_are_forbidden(client, db_url):
    from moby.api.app import app
    eid = seed(db_url, reason="low_confidence", minutes_ago=5)

    def not_a_reviewer():
        raise HTTPException(403, "reviewer role required")

    app.dependency_overrides[auth_module.require_reviewer] = not_a_reviewer
    assert client.get("/v1/review/queue").status_code == 403
    assert client.post(f"/v1/review/{eid}/decision", json={"decision": "approve"}).status_code == 403


def test_reviewer_claim_is_read_from_the_token(monkeypatch):
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "false")
    get_settings.cache_clear()
    monkeypatch.setattr(auth_module, "verify_firebase_token", lambda t: {"sub": "u1", "reviewer": t == "rev"})
    assert auth_module.require_user("Bearer rev").reviewer is True
    assert auth_module.require_user("Bearer plain").reviewer is False
    with pytest.raises(HTTPException) as e:
        auth_module.require_reviewer("Bearer plain")
    assert e.value.status_code == 403
    get_settings.cache_clear()
