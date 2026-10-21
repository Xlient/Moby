"""POST /v1/routes/check and GET /v1/routes/places: the hazard route check.

OpenRouteService is faked (no key, no network); the hazard geometry runs in the real
PostGIS `moby_test` database. Skipped when Postgres isn't reachable (docker compose up -d).
"""
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.config import get_settings
from moby.routing import ors
from moby.routing.ors import Route, RoutingError

from .test_chains_and_preferences import _test_db_url

# A road due east along latitude 37.80, from -122.30 to -122.20 (about 8.8 km).
START, END = (37.80, -122.30), (37.80, -122.20)
STRAIGHT = Route([[-122.30, 37.80], [-122.25, 37.80], [-122.20, 37.80]], 8800, 600)
# The way around: north over latitude 37.85.
AROUND = Route([[-122.30, 37.80], [-122.30, 37.85], [-122.20, 37.85], [-122.20, 37.80]], 17000, 1100)


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


@pytest.fixture
def calls(monkeypatch):
    """Fake ORS: the straight road, or the way around when asked to avoid something."""
    seen: list[dict | None] = []

    async def directions(client, key, profile, origin, destination, avoid=None):
        seen.append(avoid)
        return AROUND if avoid else STRAIGHT

    monkeypatch.setattr(ors, "directions", directions)
    return seen


@pytest.fixture
def client(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")
    monkeypatch.setenv("ORS_API_KEY", "test-key")
    get_settings.cache_clear()
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events CASCADE")
        c.execute("DELETE FROM ai_usage")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def square(lon: float, lat: float, half: float = 0.01) -> str:
    return (f"MULTIPOLYGON((({lon - half} {lat - half}, {lon + half} {lat - half}, {lon + half} {lat + half}, "
            f"{lon - half} {lat + half}, {lon - half} {lat - half})))")


def add(db_url, *, source="official", tier=2, area=None, lon=-122.25, lat=37.80, severity="high",
        expired=False, decision=None, headline="Flood Warning") -> str:
    with psycopg.connect(db_url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, title, alert_headline, "
            "location, area, expires_at, reviewer_decision) VALUES (%s, %s, %s, 'flood', %s, %s, %s, %s, "
            "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, ST_GeogFromText(%s), "
            "CASE WHEN %s THEN now() - interval '1 hour' ELSE now() + interval '6 hours' END, %s) RETURNING event_id",
            (source, "noaa" if source == "official" else None, uuid.uuid4().hex if source == "official" else None,
             severity, tier, headline, headline, lon, lat, area and f"SRID=4326;{area}", expired, decision),
        ).fetchone()
    return str(eid)


def check(client, **kw):
    body = {"origin": {"lat": START[0], "lon": START[1]}, "destination": {"lat": END[0], "lon": END[1]}, **kw}
    return client.post("/v1/routes/check", json=body)


def test_a_clear_route_says_no_known_hazards_and_offers_no_alternative(client, calls):
    r = check(client)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["route"]["hazards"] == [] and out["alternative"] is None
    assert out["route"]["distance_m"] == 8800
    assert calls == [None]                                   # ORS asked once, no avoid areas


def test_crossed_hazards_are_listed_in_order_and_avoided(client, calls, db_url):
    report = add(db_url, source="manual", tier=1, lon=-122.22, headline="Road washed out")   # 7 km along
    warning = add(db_url, area=square(-122.25, 37.80))                                        # ~4 km along
    out = check(client).json()
    assert [h["event_id"] for h in out["route"]["hazards"]] == [warning, report]
    first = out["route"]["hazards"][0]
    assert first["verification"] == "official" and first["alert_id"] == warning and 3 < first["km_along"] < 4
    assert first["at"]["lat"] == 37.8 and -122.27 < first["at"]["lon"] < -122.25   # where the road meets it
    assert out["route"]["hazards"][1]["verification"] == "community"
    assert len(calls[1]["coordinates"]) == 2                  # both shapes sent to ORS to avoid
    assert out["alternative"]["hazards"] == [] and out["alternative"]["distance_m"] == 17000


def test_what_home_wouldnt_show_doesnt_count(client, calls, db_url):
    add(db_url, area=square(-122.25, 37.80), expired=True)                 # expired
    add(db_url, source="manual", tier=1, lon=-122.22, decision="reject")   # a reviewer took it down
    add(db_url, source="manual", tier=0, lon=-122.23)                      # a single unverified report
    add(db_url, area=None)                                                 # official point (e.g. a quake centre)
    assert check(client).json()["route"]["hazards"] == []


def test_a_hazard_you_start_in_cannot_be_avoided_and_says_so(client, calls, db_url):
    add(db_url, area=square(-122.30, 37.80))
    out = check(client).json()
    assert out["route"]["hazards"][0]["cannot_avoid"] == "start_inside"
    assert out["alternative"] is None and out["alternative_problem"] == "cannot_avoid"
    assert calls == [None]


def test_when_ors_finds_no_way_around_the_app_is_told_why(client, monkeypatch, db_url):
    add(db_url, area=square(-122.25, 37.80))

    async def directions(client, key, profile, origin, destination, avoid=None):
        if avoid:
            raise RoutingError("no_route")
        return STRAIGHT

    monkeypatch.setattr(ors, "directions", directions)
    out = check(client).json()
    assert out["alternative"] is None and out["alternative_problem"] == "no_route"
    assert len(out["route"]["hazards"]) == 1


def test_if_the_way_around_still_crosses_something_it_is_reported(client, calls, db_url):
    add(db_url, area=square(-122.25, 37.80))
    on_detour = add(db_url, source="manual", tier=1, lon=-122.25, lat=37.85, headline="Landslide")
    out = check(client).json()
    assert [h["event_id"] for h in out["alternative"]["hazards"]] == [on_detour]


def test_no_key_means_route_checks_are_unavailable(client, monkeypatch):
    monkeypatch.delenv("ORS_API_KEY")
    monkeypatch.setenv("ORS_API_KEY", "")
    get_settings.cache_clear()
    r = check(client)
    assert r.status_code == 503 and r.json()["detail"] == "routing_unavailable"


def test_daily_cap(client, calls, monkeypatch):
    monkeypatch.setenv("MOBY_DAILY_CAP_ROUTE", "1")
    assert check(client).status_code == 200
    r = check(client)
    assert r.status_code == 429 and r.json()["detail"] == "daily_limit"


def test_place_search_passes_the_bias_point(client, monkeypatch):
    seen = {}

    async def search(client, key, text, near, size=6):
        seen.update(text=text, near=near)
        return [{"label": "Trailhead, Marin", "lat": 37.9, "lon": -122.6}]

    monkeypatch.setattr(ors, "search_places", search)
    r = client.get("/v1/routes/places", params={"q": "trailhead", "lat": 37.8, "lon": -122.4})
    assert r.status_code == 200 and r.json()["places"][0]["label"] == "Trailhead, Marin"
    assert seen == {"text": "trailhead", "near": (37.8, -122.4)}


def test_place_search_puts_a_few_nearby_first_then_the_best_anywhere(monkeypatch):
    """A focus point alone ranks Santa Cruz, Bolivia above Santa Cruz, CA for someone in
    California; a nearby search first fixes that, without hiding a far city ("Kathmandu")."""
    import asyncio

    calls = []

    async def pelias(client, key, params):
        calls.append(params)
        if "boundary.circle.radius" in params:
            return [{"label": "Santa Cruz, CA, USA", "lat": 36.97, "lon": -122.03}]
        return [{"label": "Santa Cruz, Bolivia", "lat": -17.8, "lon": -63.2},
                {"label": "Santa Cruz, CA, USA", "lat": 36.97, "lon": -122.03},
                {"label": "Santa Cruz, Bolivia", "lat": -17.8, "lon": -63.2}]

    monkeypatch.setattr(ors, "_pelias", pelias)
    out = asyncio.run(ors.search_places(None, "k", "Santa Cruz", (37.42, -122.08)))
    assert [p["label"] for p in out] == ["Santa Cruz, CA, USA", "Santa Cruz, Bolivia"]
    assert calls[0]["size"] == ors.NEARBY_MAX


def test_place_search_lists_each_label_once_even_among_nearby_places(monkeypatch):
    """A town and its district come back under one label; the person sees it once (the nearer)."""
    import asyncio

    async def pelias(client, key, params):
        if "boundary.circle.radius" in params:
            return [{"label": "Dujiangyan, SC, China", "lat": 30.99, "lon": 103.65},
                    {"label": "Dujiangyan, SC, China", "lat": 31.05, "lon": 103.60},
                    {"label": "Dujiangyan City, SC, China", "lat": 30.99, "lon": 103.62}]
        return [{"label": "Dujiangyan, SC, China", "lat": 31.05, "lon": 103.60}]

    monkeypatch.setattr(ors, "_pelias", pelias)
    out = asyncio.run(ors.search_places(None, "k", "Dujiangyan", (30.63, 104.03)))
    assert [p["label"] for p in out] == ["Dujiangyan, SC, China", "Dujiangyan City, SC, China"]
    assert out[0]["lat"] == 30.99
