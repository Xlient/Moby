"""Your data, your control (GDPR access, portability and erasure; Google Play account deletion).

  GET    /v1/me/export   everything the server holds about the caller, as JSON
  DELETE /v1/me          erase it: reports, saved areas, "near me", preferences, devices
                         (and their delivery logs); reviewer attribution is cleared

The app combines these with the Firestore profile it holds (export) and deletes that
profile and the Firebase account itself (erase). Aggregates that no longer identify
anyone stay: an event that several people reported keeps existing, without them.
Backups roll off within 14 days (stated in the privacy policy).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Response
from psycopg.rows import dict_row

from .auth import Caller, require_user
from .me import User

router = APIRouter(prefix="/v1", tags=["privacy"])


def _pool():
    from .app import _pool as pool  # late import: app.py owns the pool and imports this module
    return pool()


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def _rows(rows: list[dict]) -> list[dict]:
    return [{k: _iso(v) for k, v in r.items()} for r in rows]


@router.get("/me/export")
async def export_my_data(caller: User):
    me = caller.reporter_hash
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT client_event_id, hazard_type, observed_effect, severity, note, observed_at, received_at,
                      captured_offline, fusion_status, event_id::text AS event_id,
                      ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon, location_accuracy_m
               FROM reports WHERE reporter_hash = %s ORDER BY received_at""", (me,))
        reports = await cur.fetchall()
        await cur.execute(
            """SELECT kind, label, radius_km, min_severity, created_at, updated_at,
                      ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lon
               FROM subscriptions WHERE owner = %s ORDER BY created_at""", (me,))
        areas = await cur.fetchall()
        await cur.execute("SELECT alert_preferences, updated_at FROM user_preferences WHERE owner = %s", (me,))
        prefs = await cur.fetchone()
        await cur.execute(
            """SELECT device_id, platform, push_provider, registered_at, updated_at, disabled_at
               FROM devices WHERE owner = %s""", (me,))
        devices = await cur.fetchall()
        await cur.execute(
            """SELECT x.event_id::text AS event_id, x.severity, x.status, x.sent_at, x.device_id
               FROM deliveries x JOIN devices d USING (device_id) WHERE d.owner = %s ORDER BY x.sent_at""", (me,))
        deliveries = await cur.fetchall()
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "note": ("Data held by the Moby service for your account. Your profile and settings stored with "
                 "Firebase are added by the app. Push tokens are not included (they are device secrets)."),
        "reports": _rows(reports),
        "areas": _rows(areas),
        "alert_preferences": _iso(prefs["alert_preferences"]) if prefs else None,
        "devices": _rows(devices),
        "push_notifications_received": _rows(deliveries),
    }


@router.delete("/me", status_code=204)
async def erase_my_data(caller: User):
    me = caller.reporter_hash
    async with _pool().connection() as conn, conn.transaction():
        reports = (await conn.execute("DELETE FROM reports WHERE reporter_hash = %s", (me,))).rowcount
        devices = (await conn.execute("DELETE FROM devices WHERE owner = %s", (me,))).rowcount   # cascades deliveries
        areas = (await conn.execute("DELETE FROM subscriptions WHERE owner = %s", (me,))).rowcount
        await conn.execute("DELETE FROM user_preferences WHERE owner = %s", (me,))
        # Reviewer attribution is about the reviewer: drop it, keep the decision.
        await conn.execute("UPDATE review_queue SET decided_by = NULL WHERE decided_by = %s", (me,))
        await conn.execute("UPDATE guidance_bundles SET published_by = NULL WHERE published_by = %s", (me,))
        await conn.execute("INSERT INTO erasure_log (reports, devices, areas) VALUES (%s, %s, %s)",
                           (reports, devices, areas))
    return Response(status_code=204)


__all__ = ["router", "Caller", "require_user"]
