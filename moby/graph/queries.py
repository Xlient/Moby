"""SQL for the fusion graph. Plain functions: a connection in, plain values out.

The only module in moby/graph that contains SQL. Nodes call these; policy.py never does.
Only `fuse` and `save_event` call the functions that write.

Fusion rules (decided 2026-10-15):
  * The same thing = same hazard_type, within MATCH_RADIUS_M (1 km), and the event's most
    recent report is no older than MATCH_WINDOW (2 h) before this report was observed.
    An event stays alive as long as people keep reporting it.
  * Official warnings count too, from every country's feed: the report is inside or within
    1 km of the warning's area (or point), and the warning is in force. Only tier 2 counts
    (authoritative; NASA EONET is tier 1). A warning with no expiry time (quakes from USGS,
    EMSC, JMA, GDACS…) counts for OFFICIAL_WINDOW (24 h) after its last update or the last
    report attached to it, so it stays live while people report it. Official beats community.
  * Among several candidates: official first, then the closest.

PostGIS crash course for reading this file:
  * `geography` columns store points/shapes on the Earth; distances are in METRES.
  * ST_MakePoint(lon, lat): note the order, longitude first.
  * ST_SetSRID(..., 4326)::geography: "these are ordinary GPS degrees (WGS84)".
  * ST_DWithin(a, b, metres): true when a and b are within that distance (uses the index).
  * ST_Distance(a, b): the distance in metres.
"""

import json
from datetime import timedelta
from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb
from psycopg.rows import dict_row

MATCH_RADIUS_M = 1_000
MATCH_WINDOW = timedelta(hours=2)
OFFICIAL_WINDOW = timedelta(hours=24)   # official events without an expiry time (decided 2026-10-15)

# Worker leases (migration 0019).
LEASE = timedelta(minutes=5)      # a claim older than this is presumed dead and re-claimable
MAX_ATTEMPTS = 3                  # then the report is marked 'failed' (poison message)

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
        -- official: an authoritative (tier 2) warning still in force when the report was made;
        -- with no expiry time, live for 24 h after its last update or its latest report
        (e.source = 'official' AND e.tier = 2 AND (
            e.expires_at > %(observed_at)s
            OR (e.expires_at IS NULL AND GREATEST(
                    e.last_updated_at,
                    (SELECT max(r.observed_at) FROM reports r
                     WHERE r.event_id = e.event_id AND r.fusion_status = 'fused')
                ) >= %(observed_at)s::timestamptz - %(official_window)s)
        ))
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


EVENT_EFFECT_SQL = "SELECT observed_effect FROM events WHERE event_id = %(event_id)s"

# structure_report's extraction (moby/graph/schemas.py ReportDetails.to_saved()).
SAVE_STRUCTURED_SQL = "UPDATE reports SET structured = %(data)s WHERE report_id = %(report_id)s"

# Same rule as SAVE_EVENT_SQL: an agency's own wording is never replaced.
SAVE_ALERT_TEXT_SQL = """
UPDATE events SET alert_headline = %(headline)s, alert_body = %(body)s
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
            "official_window": OFFICIAL_WINDOW,
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


def save_alert_text(conn: Connection, event_id: str, headline: str, body: str) -> bool:
    """Write draft_alert's text to a community event (delivery and the app use it).
    False for official events (left untouched)."""
    cur = conn.execute(SAVE_ALERT_TEXT_SQL, {"event_id": event_id, "headline": headline, "body": body})
    return cur.rowcount == 1


def event_effect(conn: Connection, event_id: str) -> str | None:
    """What was seen when the event was first reported (stable: later reports don't change it)."""
    row = conn.execute(EVENT_EFFECT_SQL, {"event_id": event_id}).fetchone()
    return row[0] if row else None



# ── Worker: claiming work, failures, and fusion locking (migration 0019) ─────────────────

# Claim up to `limit` reports in one statement:
#   * FOR UPDATE SKIP LOCKED: rows another worker is claiming right now are skipped, not
#     waited for, so two workers never get the same report and never block each other.
#   * The UPDATE stamps the lease and commits with the caller's transaction; the row lock
#     is released then. The lease, not a lock, is what keeps others away afterwards.
#   * A report whose lease expired (its worker crashed) is claimable again.
CLAIM_SQL = """
WITH next AS (
    SELECT report_id FROM reports
    WHERE fusion_status = 'pending'
      AND attempts < %(max_attempts)s
      AND (claimed_at IS NULL OR claimed_at < now() - %(lease)s)
    ORDER BY received_at
    LIMIT %(limit)s
    FOR UPDATE SKIP LOCKED
)
UPDATE reports r
SET claimed_at = now(), claimed_by = %(worker_id)s, attempts = r.attempts + 1
FROM next WHERE r.report_id = next.report_id
RETURNING r.report_id, r.client_event_id, r.event_id, r.fusion_status, r.source, r.reporter_hash,
          r.relayed_by, r.hazard_type, r.observed_effect, r.severity,
          ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lon, r.location_accuracy_m,
          r.observed_at, r.received_at, r.captured_offline, r.note, r.structured, r.attempts
"""

# On an error: remember it. Out of attempts → 'failed' for good. Otherwise leave the lease
# in place, so the report is retried once it expires (a built-in backoff of LEASE).
FAILED_SQL = """
UPDATE reports
SET fusion_error = left(%(error)s, 500),
    fusion_status = CASE WHEN attempts >= %(max_attempts)s THEN 'failed' ELSE fusion_status END
WHERE report_id = %(report_id)s AND fusion_status = 'pending'
RETURNING fusion_status = 'failed'
"""

# Two reports of the same flood fused at the same moment by two workers would both see
# "no event yet" and both create one. A transaction-scoped advisory lock per hazard type
# makes fusion of, say, floods one-at-a-time (other hazards still run in parallel); it is
# released automatically at commit. Coarser than strictly needed, but simple and correct.
LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('moby-fuse:' || %(hazard_type)s))"


def claim_reports(conn: Connection, worker_id: str, limit: int) -> list[dict[str, Any]]:
    """Lease up to `limit` pending reports to this worker. Returns them in the graph's
    report shape (the same as the --once harness: lat/lon floats, ids and dates as strings).
    The caller must COMMIT for the claim to take effect (an autocommit connection does)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(CLAIM_SQL, {"worker_id": worker_id, "limit": limit,
                                "lease": LEASE, "max_attempts": MAX_ATTEMPTS})
        rows = cur.fetchall()
    return [json.loads(json.dumps(r, default=str)) for r in rows]


def report_failed(conn: Connection, report_id: str, error: str) -> bool:
    """Record a failed graph run. True when the report has run out of attempts and is now
    'failed'; False when it will be retried after its lease expires."""
    row = conn.execute(FAILED_SQL, {"report_id": report_id, "error": error,
                                    "max_attempts": MAX_ATTEMPTS}).fetchone()
    return bool(row and row[0])


def lock_for_fusion(conn: Connection, report: dict[str, Any]) -> None:
    """Call FIRST inside fuse's transaction: fusion of the same hazard type runs one at a time,
    so concurrent reports of one flood can't both create an event. Released at commit."""
    conn.execute(LOCK_SQL, {"hazard_type": report["hazard_type"]})


def save_structured(conn: Connection, report_id: str, data: dict) -> None:
    """Store the details structure_report read from the note (no free text: see schemas.py)."""
    conn.execute(SAVE_STRUCTURED_SQL, {"report_id": report_id, "data": Jsonb(data)})
