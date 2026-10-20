"""Delivery worker (handoff contract 5): push alerts to the people they concern.

Official alerts are pushed at tier 2. Community events (no agency behind them) are pushed,
labelled "Unverified", to people whose community_reports preference includes them:
corroborated (2+ different people, tier 1) by default, single reports (tier 0) on opt-in.
Nothing waits for a reviewer; a reviewer's reject only stops further pushes.

Each cycle:
  1. Find (event, device) pairs where a live event lies inside one of the
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

Plain language on the lock screen: a new official warning that isn't critical waits up
to HOLD_FOR for Moby's grounded explanation (moby/ai/explain.py), so the push says what
it means and what to do, in the phone's language (moby/ai/localize.py). Critical
warnings never wait. If the explanation fails its checks, runs over budget or takes too
long, the push goes out with the official wording, as before.
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from moby.ai import alert_text, localize
from moby.api.alerts import to_alert

from .fcm import Push, Result, Sender

log = logging.getLogger("moby.delivery")

FRESH_FOR = timedelta(hours=6)
MAX_ATTEMPTS = 3
BATCH = 500
HOLD_FOR = timedelta(seconds=int(os.environ.get("MOBY_PUSH_HOLD_S", "90")))

CANDIDATES_SQL = """
SELECT DISTINCT ON (e.event_id, d.device_id)
       e.event_id, e.source, e.source_feed, e.external_id, e.hazard_type, e.product, e.marine, e.severity, e.tier,
       e.title, e.description, e.alert_headline, e.alert_body, e.distinct_reporter_count, e.reports_disagree,
       e.language, e.title_en, e.description_en, e.translation_status, e.translations, e.country,
       e.first_reported_at, e.last_updated_at, e.expires_at, e.raw_payload,
       e.explainer, e.explainer_status,
       ST_Y(e.location::geometry) AS lat, ST_X(e.location::geometry) AS lon,
       d.device_id, d.push_token, d.language AS device_language
FROM events e
JOIN subscriptions s
  ON ST_DWithin(s.center, COALESCE(e.area, e.location), s.radius_km * 1000)
 AND (e.severity = 'critical'
      OR array_position(ARRAY['low','medium','high','critical'], e.severity)
         >= array_position(ARRAY['low','medium','high','critical'], s.min_severity))
JOIN devices d ON d.owner = s.owner AND d.disabled_at IS NULL AND d.registered_at < e.last_updated_at
LEFT JOIN user_preferences p ON p.owner = d.owner
WHERE ((e.source = 'official' AND e.tier = 2)
       OR (e.source <> 'official'
           AND e.tier >= CASE coalesce(p.alert_preferences->>'community_reports', 'corroborated')
                          WHEN 'all' THEN 0 WHEN 'corroborated' THEN 1 ELSE 3 END))
  AND e.reviewer_decision IS DISTINCT FROM 'reject'
  AND e.duplicate_of IS NULL
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


def _explained(row: dict[str, Any]) -> bool:
    return row.get("source") == "official" and row.get("explainer_status") == "done" and bool(row.get("explainer"))


def waits_for_explanation(row: dict[str, Any], now: datetime) -> bool:
    """Hold a fresh, non-critical official warning while its explanation is being written."""
    return (row.get("source") == "official" and row["severity"] != "critical"
            and row.get("explainer_status") in ("none", "pending")
            and len(row.get("description") or "") >= 40
            and now - row["last_updated_at"] < HOLD_FOR)


def build_push(row: dict[str, Any], localized: dict | None = None) -> Push:
    """Contract 3: draft_alert's text when present, then Moby's checked explanation (in the
    phone's language when `localized` is given), else the official wording: in the phone's
    language when Moby has translated it (alert_text), else its English translation or the original."""
    alert = to_alert(row, row.get("device_language"))
    title = row.get("alert_headline") or alert["headline"]
    translated = bool(alert.get("translated"))
    if not row.get("alert_body") and _explained(row):
        # Labelled as Moby's, like in the app; the official text is one tap away.
        title = (localized or {}).get("headline") or title
        body = " ".join(((localized or row["explainer"])["summary"]).split())
        suffix = " (Moby AI)"
        if len(body) > 240 - len(suffix):
            body = body[: 240 - len(suffix) - 1].rstrip() + "…"
        body += suffix
        translated = False
    elif row.get("alert_body"):
        body = row["alert_body"]
    elif translated:
        body = " — ".join(p for p in (alert.get("location_name"), " ".join((alert.get("body") or "").split())) if p)
    else:
        place = alert.get("location_name")
        desc = " ".join((row.get("description") or "").split())
        body = " — ".join(p for p in (place, desc) if p)
    # Always keep the translation label: truncate the text, never the label.
    suffix = f" (Translated by Moby from {alert['original_language']})" if translated else ""
    limit = 240 - len(suffix)
    if not _explained(row) or row.get("alert_body"):
        if len(body) > limit:
            body = body[: limit - 1].rstrip() + "…"
        body += suffix
    critical = row["severity"] == "critical"
    if row.get("source") in ("manual", "mesh"):
        # Never let a community report read like an agency warning: say so in the title.
        people = max(row.get("distinct_reporter_count") or 0, 1)
        who = "1 person nearby" if people == 1 else f"{people} people nearby"
        disagree = " Their reports disagree; this uses the most serious." if row.get("reports_disagree") else ""
        title = f"Unverified: {title}"
        body = f"Reported by {who}, not confirmed by officials.{disagree} {body}".strip()[:240]
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
    # Explanations need Token Factory; without it nothing is ever held.
    if localize.nano() is not None:
        now = datetime.now(timezone.utc)
        held = [r for r in rows if waits_for_explanation(r, now)]
        if held:
            await conn.execute(
                """UPDATE events SET explainer_status = 'pending'
                   WHERE event_id = ANY(%s) AND explainer_status = 'none' AND source = 'official'""",
                (list({r["event_id"] for r in held}),))
            counts["held"] = len(held)
            rows = [r for r in rows if not waits_for_explanation(r, now)]
    translated: dict[tuple, dict] = {}     # one translation per event and language, not per device
    for row in rows:
        loc = None
        if _explained(row) and (code := localize.normalize(row.get("device_language"))):
            loc = await localize.explanation_in(conn, row, code)
        elif not row.get("alert_body") and (code := localize.normalize(row.get("device_language"))):
            # The official wording in the phone's language. Critical warnings too: a 1-3 s
            # translation is worth it to someone who can't read the agency's language.
            key = (row["event_id"], code)
            if key in translated:
                row["translations"] = translated[key]
            else:
                await alert_text.alert_in(conn, row, row["device_language"])
                translated[key] = row.get("translations") or {}
        result: Result = await asyncio.to_thread(sender.send, build_push(row, loc))
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
