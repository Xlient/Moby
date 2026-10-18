"""Spec for moby/graph/queries.py: the fusion rules decided 2026-10-15, against the test database.

  * same hazard, within 1 km, event's most recent report within 2 h → same event
  * official warnings: inside/near their area and not expired; official beats community
  * several candidates: official first, then the closest
  * distinct people only; official events are never overwritten
"""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest

from moby.graph import queries as q
from moby.graph import run as harness

from .test_chains_and_preferences import _test_db_url

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("seed_reports", ROOT / "scripts" / "seed_reports.py")
seed_reports = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_reports)


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


@pytest.fixture
def conn(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)       # the harness and the seed script read this
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events, reports CASCADE")
        yield c


def seeded(conn, scenario: str) -> list[dict]:
    """Seed a scenario; return its reports as the graph sees them (oldest observation first)."""
    seed_reports.main([scenario])
    ids = [r[0] for r in conn.execute(
        "SELECT report_id::text FROM reports WHERE client_event_id LIKE %s ORDER BY observed_at",
        (f"seed-{scenario}-%",)).fetchall()]
    return [harness.fetch_report(i) for i in ids]


def fuse_one(conn, report: dict) -> str:
    """The find → create → attach sequence (your `fuse` node will do this, plus more)."""
    match = q.find_matching_event(conn, report)
    event_id = match["event_id"] if match else q.create_event(conn, report)
    q.attach_report(conn, report["report_id"], event_id)
    return event_id


def community_event(conn, *, hazard="flood", lat=37.7749, lon=-122.4194, minutes_ago=10,
                    decision=None) -> str:
    (eid,) = conn.execute(
        "INSERT INTO events (source, hazard_type, severity, location, first_reported_at, last_updated_at, "
        "reviewer_decision) VALUES ('manual', %s, 'medium', ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, "
        "now() - %s, now() - %s, %s) RETURNING event_id::text",
        (hazard, lon, lat, timedelta(minutes=minutes_ago), timedelta(minutes=minutes_ago), decision)).fetchone()
    return eid


# ── creating and attaching ───────────────────────────────────────────────────

def test_a_lone_report_creates_an_event(conn):
    (report,) = seeded(conn, "lone_low")
    assert q.find_matching_event(conn, report) is None
    eid = q.create_event(conn, report)
    assert q.attach_report(conn, report["report_id"], eid) is True
    assert q.event_reporters(conn, eid) == (1, ["low"])
    row = conn.execute("SELECT e.source, e.hazard_type, e.tier, r.fusion_status FROM events e JOIN reports r "
                       "USING (event_id) WHERE e.event_id = %s", (eid,)).fetchone()
    assert row == ("manual", "flood", 0, "fused")


def test_attaching_twice_changes_nothing(conn):
    (report,) = seeded(conn, "lone_low")
    eid = fuse_one(conn, report)
    assert q.attach_report(conn, report["report_id"], eid) is False     # safe to re-run


def test_three_people_nearby_become_one_event(conn):
    reports = seeded(conn, "corroborated_flood")
    ids = {fuse_one(conn, r) for r in reports}
    assert len(ids) == 1
    people, severities = q.event_reporters(conn, ids.pop())
    assert people == 3 and sorted(severities) == ["high", "high", "medium"]


def test_one_person_three_times_is_one_person(conn):
    reports = seeded(conn, "same_person_thrice")
    (eid,) = {fuse_one(conn, r) for r in reports}
    assert q.event_reporters(conn, eid)[0] == 1


def test_mesh_relays_are_not_reporters(conn):
    (report,) = seeded(conn, "mesh_relay")
    eid = fuse_one(conn, report)
    assert q.event_reporters(conn, eid) == (1, ["high"])
    assert conn.execute("SELECT source FROM events WHERE event_id = %s", (eid,)).fetchone()[0] == "mesh"


def test_far_apart_reports_are_separate_events(conn):
    reports = seeded(conn, "far_apart")
    assert len({fuse_one(conn, r) for r in reports}) == 2


def test_disagreeing_reports_keep_both_severities(conn):
    reports = seeded(conn, "conflicting")
    (eid,) = {fuse_one(conn, r) for r in reports}
    assert sorted(q.event_reporters(conn, eid)[1]) == ["critical", "low"]


# ── what counts as the same thing ────────────────────────────────────────────

def test_different_hazard_is_not_a_match(conn):
    community_event(conn, hazard="fire")
    (report,) = seeded(conn, "lone_low")                     # a flood at the same spot
    assert q.find_matching_event(conn, report) is None


def test_beyond_one_km_is_not_a_match(conn):
    community_event(conn, lat=37.7749 + 0.0135)              # ~1.5 km north
    (report,) = seeded(conn, "lone_low")
    assert q.find_matching_event(conn, report) is None


def test_an_event_stays_alive_while_people_report_it(conn):
    eid = community_event(conn, minutes_ago=90)               # last report 1.5 h ago: still alive
    (report,) = seeded(conn, "lone_low")
    assert q.find_matching_event(conn, report)["event_id"] == eid
    q.attach_report(conn, report["report_id"], eid)
    last = conn.execute("SELECT last_updated_at FROM events WHERE event_id = %s", (eid,)).fetchone()[0]
    assert datetime.now(timezone.utc) - last < timedelta(minutes=30)   # moved forward to this report


def test_an_event_quiet_for_over_two_hours_is_not_a_match(conn):
    community_event(conn, minutes_ago=180)
    (report,) = seeded(conn, "lone_low")
    assert q.find_matching_event(conn, report) is None


def test_a_taken_down_report_does_not_absorb_new_ones(conn):
    community_event(conn, decision="reject")
    (report,) = seeded(conn, "lone_low")
    assert q.find_matching_event(conn, report) is None


# ── official warnings ────────────────────────────────────────────────────────

def test_report_near_an_official_warning_joins_it(conn):
    (report,) = seeded(conn, "near_official")
    match = q.find_matching_event(conn, report)
    assert match is not None and match["official"] is True


def test_official_beats_a_closer_community_event(conn):
    (report,) = seeded(conn, "near_official")
    closer = community_event(conn, lat=report["lat"], lon=report["lon"])   # right on top of the report
    match = q.find_matching_event(conn, report)
    assert match["official"] is True and match["event_id"] != closer


def test_inside_a_warning_area_counts_even_far_from_its_centre(conn):
    (report,) = seeded(conn, "near_official")
    # Move the official warning's point 20 km away but give it an area that covers the report.
    conn.execute(
        "UPDATE events SET location = ST_SetSRID(ST_MakePoint(-122.20, 37.73), 4326)::geography, "
        "area = ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, 3000)::geometry)::geography "
        "WHERE source = 'official'", (report["lon"], report["lat"]))
    assert q.find_matching_event(conn, report)["official"] is True


def test_an_expired_warning_is_not_a_match(conn):
    (report,) = seeded(conn, "near_official")
    conn.execute("UPDATE events SET expires_at = now() - interval '1 hour' WHERE source = 'official'")
    assert q.find_matching_event(conn, report) is None


def test_closest_community_event_wins(conn):
    far = community_event(conn, lat=37.7749 + 0.006)          # ~670 m
    near = community_event(conn, lat=37.7749 + 0.002)         # ~220 m
    (report,) = seeded(conn, "lone_low")
    assert q.find_matching_event(conn, report)["event_id"] == near != far


# ── saving score's decisions ─────────────────────────────────────────────────

def test_save_event_writes_a_community_event(conn):
    reports = seeded(conn, "corroborated_flood")
    (eid,) = {fuse_one(conn, r) for r in reports}
    assert q.save_event(conn, eid, tier=1, severity="high", reports_disagree=False, distinct_reporters=3) is True
    row = conn.execute("SELECT tier, severity, reports_disagree, distinct_reporter_count FROM events "
                       "WHERE event_id = %s", (eid,)).fetchone()
    assert row == (1, "high", False, 3)


def test_save_event_never_overwrites_an_official_warning(conn):
    (report,) = seeded(conn, "near_official")
    eid = fuse_one(conn, report)
    assert q.save_event(conn, eid, tier=2, severity="medium", reports_disagree=False, distinct_reporters=1) is False
    assert conn.execute("SELECT severity FROM events WHERE event_id = %s", (eid,)).fetchone()[0] == "high"


def test_save_alert_text_writes_community_events_only(conn):
    reports = seeded(conn, "lone_low")
    eid = fuse_one(conn, reports[0])
    assert q.save_alert_text(conn, eid, "Flooding reported", "People nearby say…") is True
    assert conn.execute("SELECT alert_headline FROM events WHERE event_id = %s", (eid,)).fetchone()[0] == "Flooding reported"
    (official_report,) = seeded(conn, "near_official")
    official = q.find_matching_event(conn, official_report)["event_id"]
    assert q.save_alert_text(conn, official, "x", "y") is False
    assert conn.execute("SELECT alert_headline FROM events WHERE event_id = %s", (official,)).fetchone()[0] is None


# ── official warnings from every country (decided 2026-10-15) ─────────────────

def official_event(conn, *, feed="jma", hazard="earthquake", tier=2, lat=35.6895, lon=139.6917,  # noqa: F811
                   hours_ago=1, expires_in_hours=None, area_m=None, country="JP") -> str:
    """An official event like the poller writes, by default a JMA quake in Tokyo with no expiry."""
    (eid,) = conn.execute(
        "INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, location, area, "
        "country, first_reported_at, last_updated_at, expires_at) VALUES ('official', %(feed)s, %(ext)s, "
        "%(hazard)s, 'high', %(tier)s, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, "
        "CASE WHEN %(area)s::float IS NULL THEN NULL ELSE "
        "ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(area)s)::geometry)::geography END, "
        "%(country)s, now() - %(ago)s, now() - %(ago)s, "
        "CASE WHEN %(exp)s::float IS NULL THEN NULL ELSE now() + make_interval(hours => %(exp)s::int) END) "
        "RETURNING event_id::text",
        {"feed": feed, "ext": f"test-{feed}-{hours_ago}-{tier}", "hazard": hazard, "tier": tier, "lat": lat,
         "lon": lon, "area": area_m, "country": country, "ago": timedelta(hours=hours_ago),
         "exp": expires_in_hours}).fetchone()
    return eid


def report_at(lat, lon, hazard="earthquake", minutes_ago=5) -> dict:
    """A report as the graph sees it (only the fields find_matching_event reads)."""
    observed = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    return {"lat": lat, "lon": lon, "hazard_type": hazard, "observed_at": observed}


def test_a_japanese_quake_without_expiry_matches_within_24_hours(conn):
    eid = official_event(conn, hours_ago=3)
    match = q.find_matching_event(conn, report_at(35.6900, 139.6920))
    assert match == {"event_id": eid, "official": True, "distance_m": match["distance_m"]}


def test_a_quake_quiet_for_over_24_hours_no_longer_matches(conn):
    official_event(conn, feed="emsc", country=None, hours_ago=30)       # EMSC: worldwide, no expiry
    assert q.find_matching_event(conn, report_at(35.6900, 139.6920)) is None


def test_reports_keep_a_quiet_official_event_live(conn):
    eid = official_event(conn, hours_ago=30)
    # Someone reported it an hour ago (attached to it): the 24 h clock restarts from then.
    conn.execute(
        "INSERT INTO reports (client_event_id, event_id, fusion_status, reporter_hash, hazard_type, severity, "
        "location, observed_at) VALUES ('t-keepalive', %s, 'fused', %s, 'earthquake', 'medium', "
        "ST_SetSRID(ST_MakePoint(139.6917, 35.6895), 4326)::geography, now() - interval '1 hour')",
        (eid, "k" * 32))
    assert q.find_matching_event(conn, report_at(35.6900, 139.6920))["event_id"] == eid


def test_an_italian_cap_warning_matches_by_its_area(conn):
    # A MeteoAlarm-style CAP flood warning for an area around Florence, in force for 6 more hours.
    eid = official_event(conn, feed="cap", hazard="flood", lat=43.7696, lon=11.2558, area_m=8000,
                         expires_in_hours=6, country="IT")
    match = q.find_matching_event(conn, report_at(43.80, 11.28, hazard="flood"))   # ~4 km from the centre
    assert match["event_id"] == eid and match["official"] is True and match["distance_m"] == 0


def test_nasa_eonet_is_not_an_authoritative_match(conn):
    official_event(conn, feed="eonet", hazard="fire", tier=1, lat=37.7749, lon=-122.4194, country=None)
    assert q.find_matching_event(conn, report_at(37.7750, -122.4190, hazard="fire")) is None
