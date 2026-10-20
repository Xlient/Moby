"""Feed normalization and polling rules. Fixtures are trimmed real payloads
(captured 2026-10-03) so the tests track the feeds' actual formats.

    uv run pytest
"""
import asyncio
import json
from datetime import timedelta
from pathlib import Path

import httpx
import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool

from moby.feeds import eonet, gdacs, noaa, usgs
from moby.feeds.geo import centroid, region_for
from moby.feeds.poller import FEEDS, Watermark, conditional_headers, poll_feed

from .test_chains_and_preferences import _test_db_url

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def assert_valid(events) -> None:
    """Every normalized event must satisfy the events table's constraints."""
    for e in events:
        assert e.hazard_type in {"flood", "fire", "earthquake", "storm", "landslide", "other"}
        assert e.severity in {"low", "medium", "high", "critical"}
        assert e.external_id
        assert e.first_reported_at.tzinfo is not None, "timestamps must be timezone-aware"
        assert e.region in {"US", "CN", "INTL"}
        assert e.has_location or e.zone_urls


# ── NOAA ─────────────────────────────────────────────────────────────────────

def test_noaa_keeps_marine_alerts_and_flags_them():
    r = noaa.normalize(load("noaa_alerts"))
    assert r.skipped == {}
    assert len(r.events) == 3
    assert_valid(r.events)
    marine = [e for e in r.events if e.marine]
    assert [e.product for e in marine] == ["Small Craft Advisory"]
    assert marine[0].hazard_type == "storm"


def test_noaa_alerts_without_geometry_are_queued_for_zone_lookup():
    r = noaa.normalize(load("noaa_alerts"))
    zoned = [e for e in r.events if not e.has_location]
    assert len(zoned) == 2   # the land alert and the marine one
    assert all(u.startswith("https://api.weather.gov/zones/") for e in zoned for u in e.zone_urls)


def test_noaa_alert_with_polygon_is_located_inside_the_us():
    located = [e for e in noaa.normalize(load("noaa_alerts")).events if e.has_location]
    assert len(located) == 1
    assert region_for(located[0].lat, located[0].lon) == "US"


@pytest.mark.parametrize(
    ("event", "hazard"),
    [
        ("Flash Flood Warning", "flood"),
        ("Coastal Flood Advisory", "flood"),
        ("Storm Surge Warning", "flood"),     # water, not wind
        ("Red Flag Warning", "fire"),
        ("Tornado Warning", "storm"),
        ("Winter Storm Watch", "storm"),
        ("Debris Flow Warning", "landslide"),
        ("Avalanche Warning", "landslide"),
        ("Heat Advisory", "other"),
    ],
)
def test_noaa_hazard_mapping(event, hazard):
    assert noaa.hazard_for(event) == hazard


def test_noaa_cancellation_is_passed_on_to_end_its_alert():
    payload = load("noaa_alerts")
    p = payload["features"][0]["properties"]
    p["messageType"] = "Cancel"
    p["references"] = [{"identifier": "urn:oid:earlier"}]
    cancel = next(e for e in noaa.normalize(payload).events if e.cancels)
    assert cancel.references == ["urn:oid:earlier"]


def test_noaa_cancellation_without_reference_is_skipped():
    payload = load("noaa_alerts")
    payload["features"][0]["properties"].update(messageType="Cancel", references=[])
    assert noaa.normalize(payload).skipped["cancel_without_reference"] == 1


# ── USGS ─────────────────────────────────────────────────────────────────────

def test_usgs_filters_small_quakes_and_keeps_worldwide_ones():
    r = usgs.normalize(load("usgs_quakes"))
    assert len(r.events) == 2
    assert r.skipped == {"below_min_magnitude": 1}
    assert_valid(r.events)
    assert {e.region for e in r.events} == {"US", "INTL"}   # travellers: worldwide since migration 0009
    assert all(e.hazard_type == "earthquake" for e in r.events)


def test_usgs_quakes_expire_after_a_day_strong_ones_after_three():
    # Without an expiry a quake stayed an "active" alert for good (coverage check, 2026-10-18).
    r = usgs.normalize(load("usgs_quakes"))
    assert all(e.expires_at == e.first_reported_at + usgs.quake_ttl(e.severity) for e in r.events)
    assert usgs.quake_ttl("low") == usgs.quake_ttl("medium") == timedelta(hours=24)
    assert usgs.quake_ttl("high") == usgs.quake_ttl("critical") == timedelta(hours=72)
    payload = load("usgs_quakes")
    payload["features"][0]["properties"].update(mag=6.8, alert=None)
    strong = next(e for e in usgs.normalize(payload).events if e.external_id == payload["features"][0]["id"])
    assert strong.severity == "high" and strong.expires_at == strong.first_reported_at + timedelta(hours=72)


@pytest.mark.parametrize(
    ("mag", "pager", "tsunami", "expected"),
    [
        (3.0, None, False, "low"),
        (4.8, None, False, "medium"),
        (6.2, None, False, "high"),
        (7.4, None, False, "critical"),
        (5.0, "red", False, "critical"),     # PAGER impact beats magnitude
        (7.1, "green", False, "low"),        # big but remote: PAGER says low impact
        (4.0, None, True, "high"),           # tsunami flag raises the floor
    ],
)
def test_usgs_severity(mag, pager, tsunami, expected):
    assert usgs.severity_for(mag, pager, tsunami) == expected


@pytest.mark.parametrize(
    ("gap", "window"),
    [
        (timedelta(seconds=60), "all_hour"),
        (timedelta(minutes=50), "all_hour"),
        (timedelta(hours=3), "all_day"),     # restart after a few hours: no gap
        (timedelta(days=3), "all_week"),
        (timedelta(days=20), "all_month"),
        (None, "all_day"),                   # first ever run backfills a day
    ],
)
def test_usgs_window_widens_to_cover_downtime(gap, window):
    assert usgs.url_for_gap(gap).endswith(f"/{window}.geojson")


# ── EONET ────────────────────────────────────────────────────────────────────

def test_eonet_skips_sea_ice_and_uses_latest_position():
    r = eonet.normalize(load("eonet_events"))
    assert r.skipped["category_not_hazard"] == 1
    assert_valid(r.events)
    storm = load("eonet_events")["events"][2]
    kept_storm = next((e for e in r.events if e.external_id == storm["id"]), None)
    if kept_storm:  # only if the track's latest point is in a US box
        latest = max(storm["geometry"], key=lambda g: g["date"])
        assert (kept_storm.lon, kept_storm.lat) == tuple(latest["coordinates"])


@pytest.mark.parametrize(
    ("hazard", "mag", "unit", "expected"),
    [
        ("storm", 30, "kts", "low"),
        ("storm", 50, "kts", "medium"),
        ("storm", 80, "kts", "high"),
        ("storm", 120, "kts", "critical"),
        ("fire", 500, "acres", "low"),
        ("fire", 25_000, "acres", "high"),
        ("fire", None, None, "medium"),
    ],
)
def test_eonet_severity(hazard, mag, unit, expected):
    assert eonet.severity_for(hazard, mag, unit) == expected


# ── GDACS ────────────────────────────────────────────────────────────────────

def test_gdacs_keeps_worldwide_events_and_keys_on_event_not_episode():
    r = gdacs.normalize(load("gdacs_events"))
    assert len(r.events) == 2
    assert not r.skipped
    assert_valid(r.events)
    assert {e.region for e in r.events} == {"US", "INTL"}
    p = load("gdacs_events")["features"][0]["properties"]
    assert r.events[0].external_id == f"{p['eventtype']}-{p['eventid']}"


# ── Geometry and polling rules ───────────────────────────────────────────────

def test_centroid_of_polygon_and_point():
    square = {"type": "Polygon", "coordinates": [[[-100, 40], [-98, 40], [-98, 42], [-100, 42]]]}
    assert centroid(square) == (41.0, -99.0)
    assert centroid({"type": "Point", "coordinates": [-122.4, 37.8]}) == (37.8, -122.4)
    assert centroid(None) is None


@pytest.mark.parametrize(
    ("lat", "lon", "region"),
    [(37.77, -122.42, "US"), (61.2, -149.9, "US"), (21.3, -157.8, "US"), (18.4, -66.1, "US"),
     (35.7, 139.7, None), (51.5, -0.1, None)],
)
def test_region_boxes(lat, lon, region):
    assert region_for(lat, lon) == region


def _wm(**kw) -> Watermark:
    base = dict(etag=None, last_modified=None, last_success_at=None, content_hash=None, consecutive_failures=0)
    return Watermark(**{**base, **kw})


def test_conditional_headers_sent_for_the_url_they_came_from():
    wm = _wm(etag='W/"abc"', last_modified="Sat, 03 Oct 2026 15:20:20 GMT")
    assert conditional_headers(wm, usgs.HOUR_URL, usgs.HOUR_URL) == {
        "If-None-Match": 'W/"abc"',
        "If-Modified-Since": "Sat, 03 Oct 2026 15:20:20 GMT",
    }


def test_no_conditional_headers_when_the_window_widened():
    wm = _wm(last_modified="Sat, 03 Oct 2026 15:20:20 GMT")
    day_url = usgs.url_for_gap(timedelta(hours=5))
    assert conditional_headers(wm, day_url, usgs.HOUR_URL) == {}


def test_feed_cadence_matches_plan():
    assert FEEDS["noaa"].interval == FEEDS["usgs"].interval == timedelta(seconds=60)
    assert timedelta(minutes=10) <= FEEDS["eonet"].interval <= timedelta(minutes=15)
    assert timedelta(minutes=10) <= FEEDS["gdacs"].interval <= timedelta(minutes=15)


def test_default_url_is_the_steady_state_url():
    # poll_feed compares against spec.url(timedelta(0)) to decide whether validators apply.
    assert FEEDS["usgs"].url(timedelta(0)) == usgs.HOUR_URL
    assert FEEDS["noaa"].url(timedelta(0)) == noaa.URL


# ── Snapshot feeds end what they stop listing ────────────────────────────────

def test_gdacs_event_that_leaves_the_list_ends(monkeypatch):
    # GDACS lists only current events (iscurrent is always "true" there) and drops ended
    # ones without an end date, so before this a cyclone stayed "active" for good.
    db_url = _test_db_url()
    if db_url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    payload = load("gdacs_events")
    for f in payload["features"]:
        f["properties"]["iscurrent"] = "true"
    bodies = [payload, {**payload, "features": payload["features"][1:]}]
    gone = f"{payload['features'][0]['properties']['eventtype']}-{payload['features'][0]['properties']['eventid']}"

    async def poll_twice():
        async with AsyncConnectionPool(db_url, open=False) as pool:
            for body in bodies:
                transport = httpx.MockTransport(lambda _req, body=body: httpx.Response(200, json=body))
                async with httpx.AsyncClient(transport=transport) as http:
                    await poll_feed(FEEDS["gdacs"], pool, http, force=True)

    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events CASCADE")
    asyncio.run(poll_twice())
    with psycopg.connect(db_url) as c:
        rows = dict(c.execute("SELECT external_id, coalesce(expires_at <= now(), false) FROM events "
                              "WHERE source_feed = 'gdacs'").fetchall())
    assert rows[gone] is True
    assert len(rows) > 1 and not any(ended for ext, ended in rows.items() if ext != gone)
    assert FEEDS["eonet"].snapshot


# ── NOAA areas (migration 0024) ──────────────────────────────────────────────

def test_polygons_wkt():
    from moby.feeds.geo import polygons_wkt
    square = [[[-112, 35], [-111, 35], [-111, 36], [-112, 36], [-112, 35]]]
    assert polygons_wkt({"type": "Polygon", "coordinates": square}) == (
        "MULTIPOLYGON(((-112.00000 35.00000, -111.00000 35.00000, -111.00000 36.00000, "
        "-112.00000 36.00000, -112.00000 35.00000)))")
    multi = polygons_wkt({"type": "MultiPolygon", "coordinates": [square, square]})
    assert multi.count("((") == 2
    assert polygons_wkt({"type": "GeometryCollection", "geometries": [
        {"type": "Point", "coordinates": [1, 2]}, {"type": "Polygon", "coordinates": square}]}).count("((") == 1
    assert polygons_wkt({"type": "Point", "coordinates": [1, 2]}) is None and polygons_wkt(None) is None


def test_noaa_alert_with_polygon_keeps_it_as_its_area():
    (located,) = [e for e in noaa.normalize(load("noaa_alerts")).events if e.has_location]
    assert located.area_wkt.startswith("MULTIPOLYGON(((")


def square(lon, lat, d=1.0):
    return {"type": "Polygon", "coordinates": [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d],
                                                 [lon, lat]]]}


ZONES = {f"https://api.weather.gov/zones/forecast/AZZ00{i}": square(-114 + 2 * i, 34) for i in range(3)}


def resolve(db_url, events, *, fetch_max=None, monkeypatch=None):
    from moby.feeds import poller
    if fetch_max is not None:
        monkeypatch.setattr(poller, "ZONE_FETCH_MAX", fetch_max)
    fetched = []

    def handler(request: httpx.Request) -> httpx.Response:
        fetched.append(str(request.url))
        g = ZONES.get(str(request.url))
        return httpx.Response(200, json={"geometry": g, "properties": {"name": "Zone"}}) if g else httpx.Response(404)

    async def go():
        async with await psycopg.AsyncConnection.connect(db_url, autocommit=True) as conn, \
                httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await poller.resolve_zones(events, conn, http)
    return asyncio.run(go()), fetched


def zoned_event():
    r = noaa.normalize(load("noaa_alerts"))
    e = next(e for e in r.events if not e.has_location and not e.marine)
    e.zone_urls = list(ZONES)
    return e


@pytest.fixture
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


def test_zone_alerts_get_the_union_of_their_zones_as_area(db_url, monkeypatch):
    # 2026-10-20: a Flood Watch for "All of northern and central Arizona" was one point, so
    # the Grand Canyon (100 km away) didn't see it. Zones cached before 0024 have no area.
    first, last = list(ZONES)[0], list(ZONES)[-1]
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("DELETE FROM nws_zones")
        c.execute("INSERT INTO nws_zones (zone_id, zone_url, centroid) "
                  "VALUES ('AZZ000', %s, ST_SetSRID(ST_MakePoint(-113.5, 34.5), 4326)::geography)", (first,))

    partial = zoned_event()
    unlocated, fetched = resolve(db_url, [partial], fetch_max=1, monkeypatch=monkeypatch)
    assert unlocated == 0 and partial.has_location and partial.area_wkt is None   # placed, but no area yet
    assert fetched in ([list(ZONES)[1]], [last])                                   # new zones before old ones

    e = zoned_event()
    unlocated, fetched = resolve(db_url, [e], fetch_max=10, monkeypatch=monkeypatch)
    assert unlocated == 0 and first in fetched                                     # the old zone refetched
    with psycopg.connect(db_url) as c:
        inside, area_km2 = c.execute(
            "SELECT ST_Intersects(ST_GeomFromText(%s, 4326), ST_SetSRID(ST_MakePoint(-109.5, 34.5), 4326)), "
            "ST_Area(ST_GeomFromText(%s, 4326)::geography) / 1e6", (e.area_wkt, e.area_wkt)).fetchone()
    assert inside and 25_000 < area_km2 < 40_000                                  # all three ~100 km squares
    assert resolve(db_url, [zoned_event()], fetch_max=10, monkeypatch=monkeypatch)[1] == []   # cached now
