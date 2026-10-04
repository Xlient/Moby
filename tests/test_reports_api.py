"""POST /v1/reports and GET /v1/reports/{id}: write-first intake (contract 0.5.0).

Runs the real FastAPI app against the throwaway `moby_test` database (see
test_chains_and_preferences._test_db_url); skipped when Postgres isn't reachable.
"""
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.api import auth as auth_module
from moby.api import reports as reports_module
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
        c.execute("TRUNCATE reports CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def report(**kw) -> dict:
    base = {
        "client_event_id": str(uuid.uuid4()),
        "hazard_type": "flood",
        "observed_effect": "rising_water",
        "severity": "high",
        "location": {"lat": 37.77, "lon": -122.42, "accuracy_m": 25},
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "note": "  Water over the footbridge, still rising  ",
        "captured_offline": True,
    }
    return {**base, **kw}


def test_report_is_stored_pending_and_returns_202(client, db_url):
    body = report()
    r = client.post("/v1/reports", json=body)
    assert r.status_code == 202
    out = r.json()
    assert out["client_event_id"] == body["client_event_id"]
    assert out["status"] == "pending" and "event_id" not in out
    with psycopg.connect(db_url) as c:
        row = c.execute(
            "SELECT fusion_status, note, captured_offline, ST_Y(location::geometry), reporter_hash "
            "FROM reports WHERE client_event_id = %s", (body["client_event_id"],)
        ).fetchone()
    assert row[0] == "pending"
    assert row[1] == "Water over the footbridge, still rising"     # trimmed
    assert row[2] is True and abs(row[3] - 37.77) < 1e-6
    assert row[4] == auth_module.reporter_hash("dev-user") and "dev-user" not in row[4]


def test_retry_with_same_client_event_id_is_idempotent(client, db_url):
    body = report()
    first = client.post("/v1/reports", json=body).json()
    second = client.post("/v1/reports", json=body).json()
    assert first == second
    with psycopg.connect(db_url) as c:
        (n,) = c.execute("SELECT count(*) FROM reports WHERE client_event_id = %s",
                         (body["client_event_id"],)).fetchone()
    assert n == 1


def test_status_route_reflects_fusion(client, db_url):
    body = report()
    client.post("/v1/reports", json=body)
    assert client.get(f"/v1/reports/{body['client_event_id']}").json()["status"] == "pending"
    # Simulate the fusion pipeline attaching the report to an event.
    with psycopg.connect(db_url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, hazard_type, severity, location, tier) "
            "VALUES ('manual', 'flood', 'high', ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, 1) "
            "RETURNING event_id").fetchone()
        c.execute("UPDATE reports SET fusion_status = 'fused', event_id = %s WHERE client_event_id = %s",
                  (eid, body["client_event_id"]))
    out = client.get(f"/v1/reports/{body['client_event_id']}").json()
    assert out["status"] == "fused" and out["event_id"] == str(eid) and out["tier"] == 1


@pytest.mark.parametrize(
    "bad",
    [
        {"hazard_type": "volcano"},
        {"severity": "extreme"},
        {"location": {"lat": 120, "lon": 0}},
        {"location": {"lat": 37.7, "lon": -122.4, "frame": "GCJ02"}},          # CN region not enabled
        {"observed_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()},
        {"observed_at": (datetime.now(timezone.utc) - timedelta(days=9)).isoformat()},
        {"observed_at": "2026-10-04T10:00:00"},                                 # no timezone
        {"note": "x" * 1001},
        {"client_event_id": "short"},
    ],
)
def test_invalid_reports_are_rejected(client, bad):
    assert client.post("/v1/reports", json=report(**bad)).status_code == 422


def test_other_reporters_cannot_reuse_or_read_a_report(client):
    body = report()
    client.post("/v1/reports", json=body)
    from moby.api.app import app
    app.dependency_overrides[auth_module.require_user] = lambda: auth_module.Caller("someone-else", auth_module.reporter_hash("someone-else"))
    try:
        assert client.post("/v1/reports", json=body).status_code == 409
        assert client.get(f"/v1/reports/{body['client_event_id']}").status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(reports_module, "MAX_REPORTS_PER_HOUR", 3)
    codes = [client.post("/v1/reports", json=report()).status_code for _ in range(4)]
    assert codes == [202, 202, 202, 429]


def test_sign_in_required_when_auth_enabled(client, monkeypatch):
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "false")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "moby-52b4c")
    get_settings.cache_clear()
    assert client.post("/v1/reports", json=report()).status_code == 401
    r = client.post("/v1/reports", json=report(), headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code in (401, 503)   # 503 only if Google's certificates are unreachable


def test_reporter_hash_is_stable_salted_and_not_the_uid():
    h = auth_module.reporter_hash("uid-123")
    assert h == auth_module.reporter_hash("uid-123") and h != auth_module.reporter_hash("uid-124")
    assert "uid-123" not in h and len(h) == 32
