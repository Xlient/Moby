"""Privacy (migration 0013): export, erasure, retention, legal pages."""
import asyncio
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.api.auth import reporter_hash
from moby.config import get_settings
from moby.privacy.retention import apply_retention

from .test_chains_and_preferences import _test_db_url

ME = reporter_hash("dev-user")      # MOBY_AUTH_DISABLED: every request is "dev-user"


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
        c.execute("TRUNCATE events, reports, devices, subscriptions, user_preferences, deliveries, "
                  "erasure_log, review_queue CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def add_report(db_url, owner, *, note="Water over the path, my name is Ana", days_ago=0):
    with psycopg.connect(db_url, autocommit=True) as c:
        (rid,) = c.execute(
            "INSERT INTO reports (client_event_id, reporter_hash, hazard_type, severity, location, observed_at, "
            "received_at, note) VALUES (%s, %s, 'flood', 'high', "
            "ST_SetSRID(ST_MakePoint(-122.41234, 37.77891), 4326)::geography, now() - make_interval(days => %s), "
            "now() - make_interval(days => %s), %s) RETURNING report_id",
            (str(uuid.uuid4()), owner, days_ago, days_ago, note)).fetchone()
    return rid


def setup_account(client, db_url):
    client.post("/v1/me/devices", json={"device_id": "device-0001", "push_provider": "fcm",
                                        "push_token": "t" * 40, "platform": "android"})
    client.put("/v1/me/near-me", json={"center": {"lat": 37.8, "lon": -122.27}, "radius_km": 10})
    client.post("/v1/subscriptions", json={"label": "Home", "center": {"lat": 37.77, "lon": -122.42}, "radius_km": 5})
    client.put("/v1/me/alert-preferences", json={"min_severity": "high"})
    add_report(db_url, ME)
    add_report(db_url, "someone-else")


def test_export_contains_everything_about_me_only(client, db_url):
    setup_account(client, db_url)
    data = client.get("/v1/me/export").json()
    assert len(data["reports"]) == 1 and data["reports"][0]["note"].startswith("Water over")
    assert {a["kind"] for a in data["areas"]} == {"area", "near_me"}
    assert data["alert_preferences"]["min_severity"] == "high"
    assert data["devices"][0]["device_id"] == "device-0001" and "push_token" not in data["devices"][0]


def test_erase_removes_my_data_and_keeps_others(client, db_url):
    setup_account(client, db_url)
    assert client.delete("/v1/me").status_code == 204
    with psycopg.connect(db_url) as c:
        for table, col in (("reports", "reporter_hash"), ("devices", "owner"), ("subscriptions", "owner"),
                           ("user_preferences", "owner")):
            (n,) = c.execute(f"SELECT count(*) FROM {table} WHERE {col} = %s", (ME,)).fetchone()
            assert n == 0, table
        assert c.execute("SELECT count(*) FROM reports").fetchone() == (1,)          # other people's stay
        assert c.execute("SELECT reports, devices, areas FROM erasure_log").fetchone() == (1, 1, 2)
    export = client.get("/v1/me/export").json()
    assert export["reports"] == [] and export["areas"] == [] and export["alert_preferences"] is None


def test_retention_anonymises_old_reports(db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE reports, deliveries, devices CASCADE")
    old, new = add_report(db_url, ME, days_ago=91), add_report(db_url, ME, days_ago=1)

    async def run():
        async with await psycopg.AsyncConnection.connect(db_url, autocommit=True) as conn:
            return await apply_retention(conn)
    assert asyncio.run(run())["reports_anonymised"] == 1
    assert asyncio.run(run())["reports_anonymised"] == 0                             # idempotent
    with psycopg.connect(db_url) as c:
        note, rh, lon, lat, acc = c.execute(
            "SELECT note, reporter_hash, ST_X(location::geometry), ST_Y(location::geometry), location_accuracy_m "
            "FROM reports WHERE report_id = %s", (old,)).fetchone()
        assert note is None and rh == f"anon:{old}" and (lon, lat) == (-122.41, 37.78) and acc >= 1000
        assert c.execute("SELECT note FROM reports WHERE report_id = %s", (new,)).fetchone()[0] is not None


def test_legal_pages(client):
    r = client.get("/legal/privacy")
    assert r.status_code == 200 and "<h1>Moby privacy policy</h1>" in r.text and "<table>" in r.text
    assert client.get("/legal/terms").status_code == 200
    assert "Delete my account" in client.get("/legal/delete-account").text
    assert client.get("/legal/other").status_code == 422
