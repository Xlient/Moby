"""Seed the "Before you go" demo around Phakding (Everest region, Nepal). Local databases only.

    uv run --env-file .env python scripts/seed_trip_demo.py           # add (or refresh) the demo rows
    uv run --env-file .env python scripts/seed_trip_demo.py --reset   # remove them

What it adds:
  - an official-style flood alert for the Dudh Koshi with an area covering Phakding, expiring in
    two days. Its issuer is labelled "Demo data, not a real warning", so it can never pass for one;
  - a community event "Bridge washed out reported" ~1 km north of Phakding, fused from three
    reports by three different (made-up) people over the last few hours.

Then in the app: Before you go → search "Phakding" → Get briefing. Seeded rows are tagged
(external_id / client_event_id 'trip-demo-…'), so --reset removes only them.

Refuses to run against anything but a local database: a made-up official alert must never
reach real users.
"""
import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import psycopg

DEFAULT_DB = "postgresql://moby:moby@localhost:5432/moby"
PHAKDING = (27.7398, 86.7130)
BRIDGE = (27.7490, 86.7135)     # ~1 km north, on the trail to Namche Bazaar
TAG = "trip-demo-"

FLOOD_TEXT = ("The water level of the Dudh Koshi at Phakding has crossed the warning level and is rising after "
              "heavy rain upstream. People along the river banks and on trails close to the river should stay "
              "alert, keep away from the river and avoid crossing it until the level falls.")


def seed(conn: psycopg.Connection) -> None:
    now = datetime.now(timezone.utc)
    reset(conn)
    lat, lon = PHAKDING
    conn.execute(
        """INSERT INTO events (source, source_feed, external_id, region, hazard_type, severity, tier, title,
                               description, location, area, country, first_reported_at, last_updated_at,
                               expires_at, raw_payload)
           VALUES ('official', 'cap', %(ext)s, 'INTL', 'flood', 'high', 2, 'Flood warning for the Dudh Koshi',
                   %(text)s, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
                   ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, 8000)::geometry
                   )::geography,
                   'NP', %(issued)s, %(issued)s, %(expires)s, %(payload)s)""",
        {"ext": f"{TAG}flood-dudh-koshi", "text": FLOOD_TEXT, "lat": lat, "lon": lon,
         "issued": now - timedelta(minutes=95), "expires": now + timedelta(days=2),
         "payload": psycopg.types.json.Jsonb({"properties": {
             "authority": "Demo data, not a real warning", "areaDesc": "Dudh Koshi, Solukhumbu"}})})

    blat, blon = BRIDGE
    (event_id,) = conn.execute(
        """INSERT INTO events (source, region, hazard_type, observed_effect, severity, tier, confidence,
                               alert_headline, alert_body, location, distinct_reporter_count, country,
                               first_reported_at, last_updated_at)
           VALUES ('manual', 'INTL', 'flood', 'blocked_road', 'high', 1, 0.6, 'Bridge washed out reported',
                   'People nearby say it looks dangerous. Stay out of moving water and away from streams and low '
                   'roads. Follow instructions from local authorities.',
                   ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, 3, 'NP', %s, %s)
           RETURNING event_id""",
        (blon, blat, now - timedelta(hours=3), now - timedelta(minutes=70))).fetchone()
    notes = ["The suspension bridge after Phakding is washed out, trekkers turning back",
             "bridge gone above the river, no way across on the main trail",
             "Bridge washed out north of Phakding. Water very high and fast."]
    for i, (minutes, note) in enumerate(zip((180, 120, 70), notes, strict=True), 1):
        conn.execute(
            """INSERT INTO reports (client_event_id, event_id, fusion_status, reporter_hash, hazard_type,
                                    observed_effect, severity, location, observed_at, note)
               VALUES (%s, %s, 'fused', %s, 'flood', 'blocked_road', 'high',
                       ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s, %s)""",
            (f"{TAG}bridge-{i}", event_id, f"{TAG}person-{i}", blon + 0.0004 * i, blat, now - timedelta(minutes=minutes),
             note))
    print("Seeded: official flood alert (demo-labelled) + 'Bridge washed out reported' (3 people) near Phakding.")


def reset(conn: psycopg.Connection) -> None:
    conn.execute("""DELETE FROM events WHERE event_id IN (
                        SELECT event_id FROM reports WHERE client_event_id LIKE %(t)s)
                    OR external_id LIKE %(t)s""", {"t": f"{TAG}%"})
    conn.execute("DELETE FROM reports WHERE client_event_id LIKE %s", (f"{TAG}%",))
    conn.execute("DELETE FROM trip_brief_cache")    # explanations of the old rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reset", action="store_true", help="remove the demo rows")
    args = ap.parse_args()
    url = os.environ.get("DATABASE_URL", DEFAULT_DB)
    if urlparse(url).hostname not in ("localhost", "127.0.0.1", "::1", "db"):
        print("Refusing: DATABASE_URL isn't a local database (the demo alert must never reach real users).",
              file=sys.stderr)
        return 1
    with psycopg.connect(url, autocommit=True) as conn:
        if args.reset:
            reset(conn)
            print("Removed the Before you go demo rows.")
        else:
            seed(conn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
