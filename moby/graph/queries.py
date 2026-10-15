"""SQL for the fusion graph. Plain functions: a connection in, plain values out.

The only module in moby/graph that contains SQL. Nodes call these; policy.py never does.
Only `fuse` and `save_event` call the functions that write.

Fusion rules (decided 2026-10-15):
  * The same thing = same hazard_type, within MATCH_RADIUS_M (1 km), and the event's most
    recent report is no older than MATCH_WINDOW (2 h) before this report was observed.
    An event stays alive as long as people keep reporting it.
  * Official warnings count too: the report is inside or within 1 km of the warning's
    area (or point), and the warning hasn't expired. Official beats community.
  * Among several candidates: official first, then the closest.

PostGIS crash course for reading this file:
  * `geography` columns store points/shapes on the Earth; distances are in METRES.
  * ST_MakePoint(lon, lat): note the order, longitude first.
  * ST_SetSRID(..., 4326)::geography: "these are ordinary GPS degrees (WGS84)".
  * ST_DWithin(a, b, metres): true when a and b are within that distance (uses the index).
  * ST_Distance(a, b): the distance in metres.
"""
from datetime import timedelta
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row

MATCH_RADIUS_M = 1_000
MATCH_WINDOW = timedelta(hours=2)

# One candidate list built from two sources, then sorted: official first, closest first.
#   %(lat)s-style placeholders are filled in by psycopg (never paste values into SQL
#   strings yourself: that's how SQL injection happens).
FIND_MATCH_SQL = """
WITH here AS (
    SELECT ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography AS point
)
SELECT e.event_id::text AS event_id,
       e.source = 'official' AS official,
       -- Inside a warning's area counts as distance 0 (same idea as ALERTS_NEAR_SQL).
       ST_Distance(COALESCE(e.area, e.location), here.point) AS distance_m
FROM events e, here
WHERE e.hazard_type = %(hazard_type)s
  AND e.duplicate_of IS NULL                        -- the same quake from another network
  AND e.reviewer_decision IS DISTINCT FROM 'reject' -- a taken-down report doesn't absorb new ones
  AND ST_DWithin(COALESCE(e.area, e.location), here.point, %(radius_m)s)
  AND (
        -- official: any warning still in force when the report was made
        (e.source = 'official' AND (e.expires_at IS NULL OR e.expires_at > %(observed_at)s))
     OR -- community: someone reported it within the window before this report
        (e.source <> 'official' AND e.last_updated_at >= %(observed_at)s::timestamptz - %(window)s)
  )
ORDER BY official DESC, distance_m ASC
LIMIT 1
"""

CREATE_EVENT_SQL = """
INSERT INTO events (source, hazard_type, observed_effect, severity, location, location_accuracy_m,
                    first_reported_at, last_updated_at, tier, confidence, distinct_reporter_count)
VALUES (%(source)s, %(hazard_type)s, %(observed_effect)s, %(severity)s,
        ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(location_accuracy_m)s,
        %(observed_at)s, %(observed_at)s, 0, 0, 1)
RETURNING event_id::text
"""

# `fusion_status = 'pending'` makes this safe to run twice: the second time changes nothing.
ATTACH_REPORT_SQL = """
UPDATE reports SET event_id = %(event_id)s, fusion_status = 'fused'
WHERE report_id = %(report_id)s AND fusion_status = 'pending'
RETURNING observed_at
"""

# Keep a community event alive: its "most recent report" time moves forward, never back
# (an offline report from yesterday arriving late doesn't make the event look older).
TOUCH_EVENT_SQL = """
UPDATE events SET last_updated_at = GREATEST(last_updated_at, %(observed_at)s)
WHERE event_id = %(event_id)s AND source <> 'official'
"""

# count(DISTINCT …) is "how many different people": repeats from one person count once,
# and mesh relays never appear here (reporter_hash is always the original reporter).
EVENT_REPORTERS_SQL = """
SELECT count(DISTINCT reporter_hash) AS people,
       coalesce(array_agg(severity ORDER BY observed_at), '{}') AS severities
FROM reports
WHERE event_id = %(event_id)s AND fusion_status = 'fused'
"""

# Official warnings are never overwritten: the agency's tier and severity stand.
SAVE_EVENT_SQL = """
UPDATE events
SET tier = %(tier)s, severity = %(severity)s, reports_disagree = %(reports_disagree)s,
    distinct_reporter_count = %(distinct_reporters)s
WHERE event_id = %(event_id)s AND source <> 'official'
"""


def _point(report: dict[str, Any]) -> dict[str, Any]:
    return {"lat": report["lat"], "lon": report["lon"]}


def find_matching_event(conn: Connection, report: dict[str, Any]) -> dict[str, Any] | None:
    """The event this report belongs to, if any: {"event_id": str, "official": bool, "distance_m": float}."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(FIND_MATCH_SQL, {
            **_point(report),
            "hazard_type": report["hazard_type"],
            "observed_at": report["observed_at"],
            "radius_m": MATCH_RADIUS_M,
            "window": MATCH_WINDOW,
        })
        return cur.fetchone()


def create_event(conn: Connection, report: dict[str, Any]) -> str:
    """A new community event at the report's location. Returns its event_id."""
    (event_id,) = conn.execute(CREATE_EVENT_SQL, {
        **_point(report),
        "source": report["source"],             # 'manual' or 'mesh'
        "hazard_type": report["hazard_type"],
        "observed_effect": report.get("observed_effect"),
        "severity": report["severity"],
        "location_accuracy_m": report.get("location_accuracy_m"),
        "observed_at": report["observed_at"],
    }).fetchone()
    return event_id


def attach_report(conn: Connection, report_id: str, event_id: str) -> bool:
    """Link the report to the event and mark it fused. False if it was already fused (a re-run)."""
    row = conn.execute(ATTACH_REPORT_SQL, {"report_id": report_id, "event_id": event_id}).fetchone()
    if row is None:
        return False
    conn.execute(TOUCH_EVENT_SQL, {"event_id": event_id, "observed_at": row[0]})
    return True


def event_reporters(conn: Connection, event_id: str) -> tuple[int, list[str]]:
    """(distinct people, severities of every fused report) for the whole event."""
    people, severities = conn.execute(EVENT_REPORTERS_SQL, {"event_id": event_id}).fetchone()
    return people, list(severities)


def save_event(conn: Connection, event_id: str, *, tier: int, severity: str,
               reports_disagree: bool, distinct_reporters: int) -> bool:
    """Write score's decisions to a community event. False for official events (left untouched)."""
    cur = conn.execute(SAVE_EVENT_SQL, {
        "event_id": event_id, "tier": tier, "severity": severity,
        "reports_disagree": reports_disagree, "distinct_reporters": distinct_reporters,
    })
    return cur.rowcount == 1
