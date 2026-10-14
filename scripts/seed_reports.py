"""Seed the local database with pending community reports for developing the fusion graph.

    uv run --env-file .env python scripts/seed_reports.py --list
    uv run --env-file .env python scripts/seed_reports.py corroborated_flood critical_single
    uv run --env-file .env python scripts/seed_reports.py all
    uv run --env-file .env python scripts/seed_reports.py --reset        # remove everything seeded

Every scenario sits in its own spot around San Francisco (a few km apart), so scenarios
never fuse into each other. Seeded rows are tagged: reports have client_event_id
'seed-…', official events have external_id 'seed-…', so --reset removes only them.
Each scenario prints what a correct graph should do with it.
"""
import argparse
import os
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import psycopg

DEFAULT_DB = "postgresql://moby:moby@localhost:5432/moby"


@dataclass
class R:
    """One report: who, what, where (metres east/north of the scenario's spot), how long ago."""
    reporter: str
    hazard: str
    severity: str
    east_m: float = 0
    north_m: float = 0
    minutes_ago: int = 10
    effect: str | None = None
    note: str | None = None
    source: str = "manual"
    relayed_by: list[str] = field(default_factory=list)


@dataclass
class Scenario:
    expect: str
    reports: list[R]
    official: str | None = None    # hazard type of an official event placed at the spot


# Spots ~3 km apart around San Francisco (lat, lon).
SPOTS = {
    "lone_low": (37.7749, -122.4194),
    "corroborated_flood": (37.8000, -122.4194),
    "same_person_thrice": (37.7749, -122.3850),
    "critical_single": (37.7500, -122.4194),
    "conflicting": (37.7749, -122.4550),
    "near_official": (37.7300, -122.3900),
    "mesh_relay": (37.8000, -122.4550),
    "far_apart": (37.7300, -122.4550),
    "with_note": (37.7500, -122.3850),
}

SCENARIOS: dict[str, Scenario] = {
    "lone_low": Scenario(
        "1 report, 1 person, low → new event, tier 0 → draft_alert (shown to people who opted into single reports)",
        [R("alice", "flood", "low", effect="rising_water")],
    ),
    "corroborated_flood": Scenario(
        "3 people within ~150 m and 25 min → ONE event, 3 distinct reporters, tier 1 → draft_alert",
        [R("bob", "flood", "high", 0, 0, 25, "rising_water"),
         R("carol", "flood", "high", 80, 40, 15, "rising_water"),
         R("dan", "flood", "medium", -60, 110, 5, "blocked_road")],
    ),
    "same_person_thrice": Scenario(
        "1 person reports 3 times → ONE event, still 1 distinct reporter, tier 0 (repeats never corroborate)",
        [R("erin", "fire", "high", 0, 0, 30, "smoke_or_fire_visible"),
         R("erin", "fire", "high", 20, 10, 20, "smoke_or_fire_visible"),
         R("erin", "fire", "high", -15, 5, 10, "smoke_or_fire_visible")],
    ),
    "critical_single": Scenario(
        "1 critical report → tier 0 → draft_alert; review_reason severity_floor (optional flag, no pause)",
        [R("frank", "landslide", "critical", effect="blocked_road")],
    ),
    "conflicting": Scenario(
        "2 people, same place, critical vs low → ONE event at CRITICAL (the highest), reports_disagree, tier 1",
        [R("grace", "fire", "critical", 0, 0, 12, "smoke_or_fire_visible"),
         R("heidi", "fire", "low", 50, 30, 8, "other")],
    ),
    "near_official": Scenario(
        "official flood event at the spot + 1 report 300 m away → joins the official event (official match), END",
        [R("ivan", "flood", "medium", 250, 170, 5, "rising_water")],
        official="flood",
    ),
    "mesh_relay": Scenario(
        "1 report arriving over the mesh via 2 relays → 1 distinct reporter (relays never count), tier 0",
        [R("judy", "storm", "high", effect="structural_damage", source="mesh", relayed_by=["relayA", "relayB"])],
    ),
    "far_apart": Scenario(
        "2 flood reports ~20 km apart (2nd is off-spot) → TWO separate events, each tier 0",
        [R("ken", "flood", "medium", 0, 0, 10, "rising_water"),
         R("lea", "flood", "medium", 20_000, 0, 10, "rising_water")],
    ),
    "with_note": Scenario(
        "1 report with a detailed note → structure_report should extract details into reports.structured",
        [R("mia", "flood", "high", effect="rising_water",
           note="Creek over the footbridge on Elm St, about knee deep and rising fast. Two cars stuck. "
                "Started maybe 20 minutes ago after the heavy rain.")],
    ),
}


def offset(lat: float, lon: float, east_m: float, north_m: float) -> tuple[float, float]:
    """Small-distance approximation: fine for test data a few km across."""
    import math
    return lat + north_m / 111_320, lon + east_m / (111_320 * math.cos(math.radians(lat)))


def reporter_hash(name: str) -> str:
    # Real hashes are opaque hex; a readable prefix makes debugging easier.
    return f"seed-{name}".ljust(32, "0")


def seed(conn: psycopg.Connection, name: str) -> list[str]:
    sc, (lat0, lon0) = SCENARIOS[name], SPOTS[name]
    now = datetime.now(timezone.utc)
    if sc.official:
        conn.execute(
            "INSERT INTO events (source, source_feed, external_id, hazard_type, severity, title, location, "
            "tier, confidence, expires_at) VALUES ('official', 'noaa', %s, %s, 'high', %s, "
            "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, 2, 0.95, %s)",
            (f"seed-{name}-{uuid.uuid4().hex[:8]}", sc.official, f"Seeded official {sc.official} warning",
             lon0, lat0, now + timedelta(hours=6)))
    ids = []
    for r in sc.reports:
        lat, lon = offset(lat0, lon0, r.east_m, r.north_m)
        cid = f"seed-{name}-{uuid.uuid4().hex[:8]}"
        (rid,) = conn.execute(
            "INSERT INTO reports (client_event_id, source, reporter_hash, relayed_by, hazard_type, observed_effect, "
            "severity, location, location_accuracy_m, observed_at, note) VALUES "
            "(%s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, 15, %s, %s) "
            "RETURNING report_id",
            (cid, r.source, reporter_hash(r.reporter), r.relayed_by, r.hazard, r.effect, r.severity, lon, lat,
             now - timedelta(minutes=r.minutes_ago), r.note)).fetchone()
        ids.append(str(rid))
    return ids


def reset(conn: psycopg.Connection) -> None:
    n_rep = conn.execute("DELETE FROM reports WHERE client_event_id LIKE 'seed-%'").rowcount
    # Events your graph created from seeded reports have no other reports left once those are gone.
    n_ev = conn.execute(
        "DELETE FROM events e WHERE (e.source = 'official' AND e.external_id LIKE 'seed-%') "
        "OR (e.source <> 'official' AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.event_id = e.event_id))"
    ).rowcount
    print(f"removed {n_rep} seeded reports and {n_ev} events (seeded official + community events left empty)")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("scenarios", nargs="*", help="scenario names, or 'all'")
    p.add_argument("--list", action="store_true", help="list scenarios and what the graph should do")
    p.add_argument("--reset", action="store_true", help="delete seeded rows first")
    args = p.parse_args(argv)

    if args.list or not (args.scenarios or args.reset):
        for name, sc in SCENARIOS.items():
            print(f"{name:20} {sc.expect}")
        return 0
    names = list(SCENARIOS) if args.scenarios == ["all"] else args.scenarios
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        p.error(f"unknown scenario(s): {', '.join(unknown)} (see --list)")

    with psycopg.connect(os.environ.get("DATABASE_URL", DEFAULT_DB), autocommit=True) as conn:
        if args.reset:
            reset(conn)
        for name in names:
            ids = seed(conn, name)
            print(f"{name}: {len(ids)} pending report(s) → expect: {SCENARIOS[name].expect}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
