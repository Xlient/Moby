"""Feed normalization and polling rules. Fixtures are trimmed real payloads
(captured 2026-10-03) so the tests track the feeds' actual formats.

    uv run pytest
"""
import json
from datetime import timedelta
from pathlib import Path

import pytest

from moby.feeds import eonet, gdacs, noaa, usgs
from moby.feeds.geo import centroid, region_for
from moby.feeds.poller import FEEDS, Watermark, conditional_headers

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
