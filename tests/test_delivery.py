"""Delivery (migration 0007): account routes and the push fan-out worker."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.api.auth import reporter_hash
from moby.config import get_settings
from moby.delivery.fcm import Push, Result, message
from moby.delivery.worker import build_push, deliver_once

from .test_chains_and_preferences import _test_db_url

TOKEN = "fcm-token-" + "x" * 40


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


@pytest.fixture
def client(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")    # caller is "dev-user"
    get_settings.cache_clear()
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events, devices, subscriptions, user_preferences, deliveries, briefs CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


class FakeSender:
    def __init__(self, outcome="sent"):
        self.outcome, self.pushes = outcome, []

    def send(self, push: Push) -> Result:
        self.pushes.append(push)
        return Result(self.outcome, None if self.outcome == "sent" else "boom")


def add_event(db_url, *, severity="high", hazard="flood", lat=37.80, lon=-122.27, tier=2, marine=False,
              updated_minutes_ago=1, headline=None) -> str:
    with psycopg.connect(db_url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, marine, title, "
            "description, location, first_reported_at, last_updated_at, product, alert_headline) VALUES "
            "('official', 'noaa', %s, %s, %s, %s, %s, 'Flood Warning issued', 'River rising fast.', "
            "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, now() - %s, now() - %s, 'Flood Warning', %s) "
            "RETURNING event_id",
            (str(uuid.uuid4()), hazard, severity, tier, marine, lon, lat,
             timedelta(minutes=updated_minutes_ago + 5), timedelta(minutes=updated_minutes_ago), headline)).fetchone()
    return str(eid)


def deliver(db_url, sender):
    async def go():
        async with await psycopg.AsyncConnection.connect(db_url, autocommit=True) as conn:
            return await deliver_once(conn, sender)
    return asyncio.run(go())


def setup_device(client, db_url, *, near_me=True):
    assert client.post("/v1/me/devices", json={"device_id": "device-0001", "push_provider": "fcm",
                                               "push_token": TOKEN, "platform": "android"}).status_code == 204
    with psycopg.connect(db_url, autocommit=True) as c:   # registered before the events below
        c.execute("UPDATE devices SET registered_at = now() - interval '1 hour'")
    if near_me:
        assert client.put("/v1/me/near-me", json={"center": {"lat": 37.8044, "lon": -122.2711},
                                                  "radius_km": 10}).status_code == 204


# ── Account routes ───────────────────────────────────────────────────

def test_subscriptions_crud_and_ownership(client, db_url):
    r = client.post("/v1/subscriptions", json={"label": " Home ", "center": {"lat": 37.77, "lon": -122.42},
                                               "radius_km": 5, "min_severity": "high"})
    assert r.status_code == 201
    sub = r.json()
    assert sub["label"] == "Home" and sub["min_severity"] == "high" and sub["center"]["lat"] == pytest.approx(37.77)
    client.put("/v1/me/near-me", json={"center": {"lat": 37.80, "lon": -122.27}, "radius_km": 10})
    assert [s["subscription_id"] for s in client.get("/v1/subscriptions").json()] == [sub["subscription_id"]]
    with psycopg.connect(db_url, autocommit=True) as c:   # someone else's area can't be deleted
        (other,) = c.execute("INSERT INTO subscriptions (owner, center, radius_km) VALUES "
                             "('someone-else', ST_MakePoint(0, 0)::geography, 5) RETURNING subscription_id").fetchone()
    assert client.delete(f"/v1/subscriptions/{other}").status_code == 404
    assert client.delete(f"/v1/subscriptions/{sub['subscription_id']}").status_code == 204
    assert client.post("/v1/subscriptions", json={"center": {"lat": 1, "lon": 1}, "radius_km": 900}).status_code == 422


def test_near_me_is_coarse_and_single(client, db_url):
    for lat in (37.80441, 37.81234):
        client.put("/v1/me/near-me", json={"center": {"lat": lat, "lon": -122.27111}, "radius_km": 10})
    with psycopg.connect(db_url) as c:
        rows = c.execute("SELECT ST_Y(center::geometry), ST_X(center::geometry) FROM subscriptions "
                         "WHERE kind = 'near_me'").fetchall()
    assert rows == [(pytest.approx(37.81), pytest.approx(-122.27))]


def test_preferences_round_trip_normalized(client):
    r = client.put("/v1/me/alert-preferences", json={"hazard_types": [], "min_severity": "high"})
    assert r.json() == {"hazard_types": ["earthquake", "fire", "flood", "landslide", "other", "storm"],
                        "min_severity": "high", "include_marine": False}
    assert client.get("/v1/me/alert-preferences").json()["min_severity"] == "high"


def test_token_moves_with_the_install(client, db_url):
    body = {"device_id": "device-0001", "push_provider": "fcm", "push_token": TOKEN, "platform": "android"}
    client.post("/v1/me/devices", json=body)
    client.post("/v1/me/devices", json={**body, "device_id": "device-0002"})
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT device_id, owner FROM devices").fetchall() == [("device-0002", reporter_hash("dev-user"))]


# ── Brief route (contract 4) ─────────────────────────────────────────

def test_brief_pending_ready_and_missing(client, db_url):
    eid = add_event(db_url)
    assert client.get(f"/v1/events/{eid}/brief").status_code == 404
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("UPDATE events SET brief_status = 'pending' WHERE event_id = %s", (eid,))
    r = client.get(f"/v1/events/{eid}/brief")
    assert r.status_code == 202 and r.json()["status"] == "pending"
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("INSERT INTO briefs (event_id, model, summary, uncertainty, sources) VALUES "
                  "(%s, 'nemotron-3-ultra', 'River cresting tonight.', 'Gauge data is 2 h old.', '[\"NWS\"]')", (eid,))
    b = client.get(f"/v1/events/{eid}/brief").json()
    assert b["summary"] == "River cresting tonight." and b["uncertainty"] and b["sources"] == ["NWS"]


# ── Worker ───────────────────────────────────────────────────────────

def test_pushes_once_per_severity_and_again_on_upgrade(client, db_url):
    setup_device(client, db_url)
    eid = add_event(db_url, severity="high")
    sender = FakeSender()
    assert deliver(db_url, sender)["sent"] == 1
    assert deliver(db_url, sender)["sent"] == 0                    # idempotent
    push = sender.pushes[0]
    assert push.token == TOKEN and push.data["event_id"] == eid and not push.critical
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("UPDATE events SET severity = 'critical', last_updated_at = now() WHERE event_id = %s", (eid,))
    assert deliver(db_url, sender)["sent"] == 1
    assert sender.pushes[-1].critical and sender.pushes[-1].title.startswith("Critical")
    with psycopg.connect(db_url, autocommit=True) as c:          # downgrade: no buzz
        c.execute("UPDATE events SET severity = 'high', last_updated_at = now() WHERE event_id = %s", (eid,))
    assert deliver(db_url, sender)["sent"] == 0


def test_who_gets_pushed(client, db_url):
    setup_device(client, db_url)
    add_event(db_url, lat=34.05, lon=-118.24)                     # far away
    add_event(db_url, tier=1)                                     # not confirmed
    add_event(db_url, severity="low")                             # below near-me floor (medium)
    add_event(db_url, marine=True)                                # marine is opt-in
    add_event(db_url, updated_minutes_ago=60 * 7)                 # stale
    sender = FakeSender()
    assert deliver(db_url, sender)["sent"] == 0
    add_event(db_url, severity="critical", marine=True)           # critical bypasses everything
    assert deliver(db_url, sender)["sent"] == 1


def test_preferences_quiet_lesser_alerts_but_never_critical(client, db_url):
    setup_device(client, db_url)
    client.put("/v1/me/alert-preferences", json={"hazard_types": ["fire"], "min_severity": "low"})
    add_event(db_url, hazard="flood", severity="high")
    sender = FakeSender()
    assert deliver(db_url, sender)["sent"] == 0
    add_event(db_url, hazard="flood", severity="critical")
    assert deliver(db_url, sender)["sent"] == 1


def test_saved_area_uses_its_own_floor(client, db_url):
    setup_device(client, db_url, near_me=False)
    client.post("/v1/subscriptions", json={"center": {"lat": 37.80, "lon": -122.27}, "radius_km": 5,
                                           "min_severity": "low"})
    add_event(db_url, severity="low")
    assert deliver(db_url, FakeSender())["sent"] == 1


def test_dead_tokens_disable_the_device_and_failures_retry(client, db_url):
    setup_device(client, db_url)
    add_event(db_url)
    flaky = FakeSender("failed")
    for _ in range(5):
        deliver(db_url, flaky)
    assert len(flaky.pushes) == 3                                  # MAX_ATTEMPTS
    add_event(db_url)
    assert deliver(db_url, FakeSender("invalid_token"))["invalid_token"] == 1
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT disabled_at IS NOT NULL FROM devices").fetchone() == (True,)
    add_event(db_url)
    assert deliver(db_url, FakeSender())["sent"] == 0              # disabled until re-registered


def test_push_text_prefers_drafted_alert_and_fcm_message_shape(db_url):
    row = {"event_id": uuid.uuid4(), "source_feed": "noaa", "product": "Flood Warning", "severity": "critical",
           "tier": 2, "hazard_type": "flood", "title": "x", "description": "  River   rising. " * 30,
           "raw_payload": {"properties": {"areaDesc": "Russian River; Sonoma"}}, "marine": False,
           "first_reported_at": datetime.now(timezone.utc), "expires_at": None, "lat": 1.0, "lon": 2.0,
           "alert_headline": None, "alert_body": None, "push_token": TOKEN}
    p = build_push(row)
    assert p.title == "Critical: Flood warning" and p.body.startswith("Russian River — River rising.")
    assert len(p.body) <= 240 and p.body.endswith("…")
    assert build_push({**row, "alert_headline": "Leave the riverbank now", "alert_body": "Water rising 1 m/h."}).body \
        == "Water rising 1 m/h."
    m = message(p)["message"]
    assert m["android"]["notification"]["channel_id"] == "critical" and m["android"]["priority"] == "high"
    assert m["data"]["event_id"] == str(row["event_id"]) and m["android"]["notification"]["tag"] == str(row["event_id"])


def test_community_alert_shape(client, db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, hazard_type, severity, tier, title, location, alert_headline, alert_body, "
            "distinct_reporter_count) VALUES ('manual', 'flood', 'high', 2, 'Flooding', "
            "ST_SetSRID(ST_MakePoint(-122.26, 37.80), 4326)::geography, 'Water over the path', 'Avoid the east shore.', 3) "
            "RETURNING event_id").fetchone()
    a = client.get(f"/v1/alerts/{eid}").json()
    assert a["headline"] == "Water over the path" and a["body"] == "Avoid the east shore."
    assert a["verification_label"] == "corroborated_report" and a["corroboration_count"] == 3
    assert a["source_attribution"] == "Community reports"


def test_home_lists_what_delivery_may_push(client, db_url):
    """Community events are listed like official ones at their tier; rejected and tier-0 never are."""
    with psycopg.connect(db_url, autocommit=True) as c:
        def add(tier, decision=None):
            (eid,) = c.execute(
                "INSERT INTO events (source, hazard_type, severity, tier, reviewer_decision, location) VALUES "
                "('manual', 'flood', 'high', %s, %s, ST_SetSRID(ST_MakePoint(-122.26, 37.80), 4326)::geography) "
                "RETURNING event_id", (tier, decision)).fetchone()
            return str(eid)
        listed, confirmed = add(1), add(2)
        add(0), add(2, "reject")
    def ids(q=""):
        return {a["alert_id"] for a in client.get(f"/v1/alerts?lat=37.80&lon=-122.27&radius_km=10{q}").json()["alerts"]}
    assert ids() == {confirmed}                        # default min_tier=2: exactly what may be pushed
    assert ids("&min_tier=1") == {listed, confirmed}
