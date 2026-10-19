"""GET /v1/demo/hot-zones and /v1/demo/replay: trying Moby away from a disaster.

Ranking and replay placement are pure functions; the endpoints run against the real
PostGIS `moby_test` database. Skipped when Postgres isn't reachable (docker compose up -d).
"""
import math
import uuid
from datetime import datetime, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.api import demo
from moby.api.demo import rank_zones, replay_alerts
from moby.config import get_settings

from .test_chains_and_preferences import _test_db_url

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def ev(cell=(0, 0), hazard="flood", severity="medium", source="official"):
    return {"event_id": uuid.uuid4(), "cy": cell[0], "cx": cell[1], "hazard_type": hazard,
            "severity": severity, "source": source}


def test_variety_and_severity_beat_sheer_volume():
    rainy = [ev((1, 1), "storm", "low") for _ in range(40)]
    mixed = [ev((2, 2), "earthquake", "high"), ev((2, 2), "flood", "critical"), ev((2, 2), "fire", "medium")]
    zones = rank_zones(rainy + mixed, 5)
    assert [z.cell for z in zones] == [(2, 2), (1, 1)]


def test_community_reports_add_to_a_zone_and_the_lead_is_the_worst_official_alert():
    official = ev((3, 3), "flood", "critical")
    report = ev((3, 3), "flood", "critical", source="manual")
    quiet = ev((4, 4), "flood", "critical")
    zones = rank_zones([report, official, quiet], 5)
    assert zones[0].cell == (3, 3)
    assert zones[0].lead is official            # an agency's warning before a report of the same severity


def raw(severity="high", source="official", hazard="flood", **kw):
    return {"event_id": uuid.uuid4(), "source": source, "source_feed": "noaa" if source == "official" else None,
            "hazard_type": hazard, "product": "Flood Warning", "marine": False, "severity": severity,
            "tier": 2 if source == "official" else 1, "title": "Flood Warning", "description": "Move up now." * 5,
            "first_reported_at": datetime(2026, 7, 12, 3, 0, tzinfo=timezone.utc), "expires_at": None,
            "lat": 30.9, "lon": 103.6, "country": "CN",
            "raw_payload": {"properties": {"areaDesc": "Dujiangyan"}}, **kw}


def test_replay_puts_the_worst_official_alert_on_the_point_and_says_what_it_really_was():
    rows = [raw("high", hazard="storm"), raw("critical", source="manual"), raw("critical")]
    out = replay_alerts(rows, 14.6, 121.0, NOW)
    first = out[0]
    assert first["severity"] == "critical" and first["verification_label"] == "official_confirmed"
    assert first["location"] == {"lat": 14.6, "lon": 121.0, "frame": "WGS84"} and first["distance_km"] == 0
    assert first["demo"] is True and first["alert_id"] == f"demo-{first['event_id']}"
    assert first["replay_of"] == {"issued_at": "2026-07-12T03:00:00+00:00", "location_name": "Dujiangyan"}
    assert first["expires_at"] > NOW.isoformat() and first["issued_at"] < NOW.isoformat()
    assert "country" not in first and "location_name" not in first   # numbers and place: where you are
    assert out[-1]["verification_label"] == "corroborated_report"   # the report stays a report, last
    for a in out[1:]:
        km = haversine_km(14.6, 121.0, a["location"]["lat"], a["location"]["lon"])
        assert abs(km - a["distance_km"]) < 0.1 and 1 < km < 20


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
    monkeypatch.setattr(demo, "_hot_cache", None)
    get_settings.cache_clear()
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def add(db_url, *, lat, lon, hazard="flood", severity="high", source="official", tier=None, marine=False,
        age="1 hour", expires="6 hours", description="Flooding is expected. Move to higher ground now."):
    with psycopg.connect(db_url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, title, description, "
            "marine, location, first_reported_at, last_updated_at, expires_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, 'Warning', %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, "
            "now() - %s::interval, now() - %s::interval, now() + %s::interval) RETURNING event_id",
            (source, "noaa" if source == "official" else None, uuid.uuid4().hex if source == "official" else None,
             hazard, severity, tier if tier is not None else (2 if source == "official" else 1), description,
             marine, lon, lat, age, age, expires),
        ).fetchone()
    return str(eid)


def test_hot_zones_lists_todays_busiest_places_centred_on_their_worst_alert(client, db_url):
    add(db_url, lat=14.6, lon=121.0, severity="critical")
    add(db_url, lat=14.7, lon=121.1, hazard="landslide")
    add(db_url, lat=14.5, lon=121.2, hazard="flood", source="manual")
    add(db_url, lat=37.8, lon=-122.3, hazard="storm", severity="low")
    add(db_url, lat=40.0, lon=-70.0, marine=True, severity="critical")          # marine: not a place to stand
    add(db_url, lat=35.0, lon=139.0, expires="-1 hour")                         # over
    add(db_url, lat=-33.9, lon=151.2, age="3 days")                             # not today
    zones = client.get("/v1/demo/hot-zones").json()["zones"]
    assert len(zones) == 2
    top = zones[0]
    assert top["center"] == {"lat": 14.6, "lon": 121.0} and top["top_severity"] == "critical"
    assert top["alert_count"] == 3 and top["has_community_reports"] is True
    assert set(top["hazard_types"]) == {"flood", "landslide"}
    assert zones[1]["center"] == {"lat": 37.8, "lon": -122.3}


def test_replay_returns_real_past_alerts_without_storing_or_listing_them(client, db_url):
    past = add(db_url, lat=30.9, lon=103.6, severity="critical", age="40 days", expires="-39 days")
    add(db_url, lat=30.9, lon=103.6, hazard="earthquake", age="50 days", expires="-49 days", description="short")
    out = client.get("/v1/demo/replay", params={"lat": 14.6, "lon": 121.0}).json()["alerts"]
    assert [a["event_id"] for a in out] == [past]          # too little text to explain: not replayed
    assert out[0]["demo"] is True and out[0]["distance_km"] == 0
    # Nobody else sees it: the real list at that point is empty, and nothing was written.
    assert client.get("/v1/alerts", params={"lat": 14.6, "lon": 121.0}).json()["alerts"] == []
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT count(*) FROM events").fetchone()[0] == 2
