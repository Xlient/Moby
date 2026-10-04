"""Delivery worker (handoff contract 5): push tier-2 events to the people they concern.

Each cycle:
  1. Find (event, device) pairs where a live tier-2 event lies inside one of the
     device owner's areas (saved areas or "near me") at or above that area's
     severity floor — critical always qualifies.
  2. Drop pairs the owner's alert preferences filter out (critical never is) —
     the same rule as AlertPreferences.matches, in SQL so the batch limit only
     ever counts pushes still to send.
  3. Push, and log every attempt in `deliveries`.

`deliveries` is unique on (event, device, severity), so re-running a cycle never
double-notifies, while an upgrade (high → critical) notifies again. A failed push is
retried on later cycles, up to MAX_ATTEMPTS.

Only events that changed after the device registered, and within FRESH_FOR, are
pushed: a fresh install isn't flooded with everything already on the map.
"""
import asyncio
import logging
from datetime import timedelta
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from moby.api.alerts import to_alert

from .fcm import Push, Result, Sender

log = logging.getLogger("moby.delivery")

FRESH_FOR = timedelta(hours=6)
MAX_ATTEMPTS = 3
BATCH = 500

CANDIDATES_SQL = """
SELECT DISTINCT ON (e.event_id, d.device_id)
       e.event_id, e.source, e.source_feed, e.external_id, e.hazard_type, e.product, e.marine, e.severity, e.tier,
       e.title, e.description, e.alert_headline, e.alert_body,
       e.first_reported_at, e.last_updated_at, e.expires_at, e.raw_payload,
       ST_Y(e.location::geometry) AS lat, ST_X(e.location::geometry) AS lon,
       d.device_id, d.push_token
FROM events e
JOIN subscriptions s
  ON ST_DWithin(s.center, COALESCE(e.area, e.location), s.radius_km * 1000)
 AND (e.severity = 'critical'
      OR array_position(ARRAY['low','medium','high','critical'], e.severity)
         >= array_position(ARRAY['low','medium','high','critical'], s.min_severity))
JOIN devices d ON d.owner = s.owner AND d.disabled_at IS NULL AND d.registered_at < e.last_updated_at
LEFT JOIN user_preferences p ON p.owner = d.owner
WHERE e.tier = 2
  AND e.reviewer_decision IS DISTINCT FROM 'reject'
  AND (e.expires_at IS NULL OR e.expires_at > now())
  AND (e.severity = 'critical'
       OR ((coalesce(jsonb_array_length(p.alert_preferences->'hazard_types'), 0) = 0
            OR p.alert_preferences->'hazard_types' ? e.hazard_type)
           AND array_position(ARRAY['low','medium','high','critical'], e.severity)
               >= array_position(ARRAY['low','medium','high','critical'],
                                 coalesce(p.alert_preferences->>'min_severity', 'low'))
           AND (coalesce((p.alert_preferences->>'include_marine')::boolean, false) OR NOT e.marine)))
  AND e.last_updated_at > now() - %(fresh)s
  -- Not yet told at this severity (or a still-retryable failure)...
  AND NOT EXISTS (
        SELECT 1 FROM deliveries x
        WHERE x.event_id = e.event_id AND x.device_id = d.device_id AND x.severity = e.severity
          AND (x.status <> 'failed' OR x.attempts >= %(max_attempts)s))
  -- ...nor about the same warning from the same agency in the last day (agencies such as
  -- AEMET issue one message per time period of a warning: same wording, same area)...
  AND NOT EXISTS (
        SELECT 1 FROM deliveries z JOIN events ze ON ze.event_id = z.event_id
        WHERE z.device_id = d.device_id AND z.status = 'sent' AND z.sent_at > now() - interval '1 day'
          AND ze.event_id <> e.event_id AND ze.source_feed = e.source_feed AND ze.title = e.title
          AND ze.severity = e.severity AND ST_DWithin(ze.location, e.location, 1000))
  -- ...and never told at a higher severity (a downgrade isn't news worth a buzz).
  AND NOT EXISTS (
        SELECT 1 FROM deliveries y
        WHERE y.event_id = e.event_id AND y.device_id = d.device_id AND y.status = 'sent'
          AND array_position(ARRAY['low','medium','high','critical'], y.severity)
              > array_position(ARRAY['low','medium','high','critical'], e.severity))
ORDER BY e.event_id, d.device_id
LIMIT %(batch)s
"""

LOG_SQL = """
INSERT INTO deliveries (event_id, device_id, severity, status, error)
VALUES (%(event_id)s, %(device_id)s, %(severity)s, %(status)s, %(error)s)
ON CONFLICT (event_id, device_id, severity) DO UPDATE
SET status = EXCLUDED.status, error = EXCLUDED.error, sent_at = now(),
    attempts = deliveries.attempts + 1
"""


def build_push(row: dict[str, Any]) -> Push:
    """Contract 3: draft_alert's text when present, else the official wording."""
    alert = to_alert(row)
    title = row.get("alert_headline") or alert["headline"]
    if row.get("alert_body"):
        body = row["alert_body"]
    else:
        place = alert.get("location_name")
        desc = " ".join((row.get("description") or "").split())
        body = " — ".join(p for p in (place, desc) if p)
    if len(body) > 240:
        body = body[:239].rstrip() + "…"
    critical = row["severity"] == "critical"
    return Push(
        token=row["push_token"],
        title=("Critical: " + title) if critical and not title.lower().startswith("critical") else title,
        body=body or "Tap for details.",
        data={"alert_id": alert["alert_id"], "event_id": alert["event_id"], "severity": row["severity"]},
        critical=critical,
        tag=alert["event_id"],
    )


async def deliver_once(conn: AsyncConnection, sender: Sender) -> dict[str, int]:
    """One fan-out pass. Returns counts by outcome."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(CANDIDATES_SQL, {"fresh": FRESH_FOR, "max_attempts": MAX_ATTEMPTS, "batch": BATCH})
        rows = await cur.fetchall()

    counts = {"sent": 0, "failed": 0, "invalid_token": 0}
    for row in rows:
        result: Result = await asyncio.to_thread(sender.send, build_push(row))
        counts[result.outcome] += 1
        async with conn.transaction():
            await conn.execute(LOG_SQL, {"event_id": row["event_id"], "device_id": row["device_id"],
                                         "severity": row["severity"], "status": result.outcome,
                                         "error": result.error})
            if result.outcome == "invalid_token":
                await conn.execute("UPDATE devices SET disabled_at = now() WHERE device_id = %s",
                                   (row["device_id"],))
    if any(counts.values()):
        log.info("delivery: %s", ", ".join(f"{k} {v}" for k, v in counts.items() if v))
    return counts
