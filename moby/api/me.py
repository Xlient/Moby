"""Per-person delivery settings (handoff contract 5): push devices, alert
preferences, watched areas and the "near me" area that follows the phone.

Everything is keyed by `owner` = the caller's reporter_hash, so the database never
holds a Firebase uid. The app keeps profile data in Firestore; these live here
because the delivery worker needs them next to the events.
"""
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from moby.alerts.preferences import AlertPreferences
from moby.feeds.schema import HazardType, Severity

from .auth import Caller, require_user
from .reports import GeoPointIn

router = APIRouter(prefix="/v1", tags=["me"])
User = Annotated[Caller, Depends(require_user)]

MAX_AREAS = 20


def _pool():
    from .app import _pool as pool  # late import: app.py owns the pool and imports this module
    return pool()


# ── Devices ──────────────────────────────────────────────────────────

class DeviceIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    push_provider: Literal["fcm", "apns"]
    push_token: str = Field(min_length=20, max_length=4096)
    platform: Literal["ios", "android"]


@router.post("/me/devices", status_code=204)
async def register_device(body: DeviceIn, caller: User):
    async with _pool().connection() as conn, conn.transaction():
        # Concurrent registrations of one token (the app's first fetch and FCM's token
        # callback can race) would trip devices_token_unique: serialize per token.
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (body.push_token,))
        # A token moves with the install: drop any other row holding it (e.g. reinstall
        # under a new device_id, or a different person signing in on this phone).
        await conn.execute("DELETE FROM devices WHERE push_token = %s AND device_id <> %s",
                           (body.push_token, body.device_id))
        await conn.execute(
            """INSERT INTO devices (device_id, owner, push_provider, push_token, platform)
               VALUES (%(id)s, %(owner)s, %(provider)s, %(token)s, %(platform)s)
               ON CONFLICT (device_id) DO UPDATE
               SET owner = EXCLUDED.owner, push_provider = EXCLUDED.push_provider,
                   push_token = EXCLUDED.push_token, platform = EXCLUDED.platform,
                   updated_at = now(), disabled_at = NULL""",
            {"id": body.device_id, "owner": caller.reporter_hash, "provider": body.push_provider,
             "token": body.push_token, "platform": body.platform},
        )
    return Response(status_code=204)


@router.delete("/me/devices/{device_id}", status_code=204)
async def unregister_device(device_id: str, caller: User):
    """On sign-out: this phone stops receiving this person's alerts."""
    async with _pool().connection() as conn:
        await conn.execute("DELETE FROM devices WHERE device_id = %s AND owner = %s",
                           (device_id, caller.reporter_hash))
    return Response(status_code=204)


# ── Alert preferences ────────────────────────────────────────────────

class PreferencesIn(BaseModel):
    hazard_types: list[HazardType] = Field(default_factory=list, max_length=6)
    min_severity: Severity = "low"
    include_marine: bool = False


@router.get("/me/alert-preferences")
async def get_preferences(caller: User):
    async with _pool().connection() as conn:
        row = await (await conn.execute(
            "SELECT alert_preferences FROM user_preferences WHERE owner = %s", (caller.reporter_hash,))).fetchone()
    return AlertPreferences.from_dict(row[0] if row else None).to_dict()


@router.put("/me/alert-preferences")
async def put_preferences(body: PreferencesIn, caller: User):
    prefs = AlertPreferences.from_dict(body.model_dump()).to_dict()   # normalized, as the contract says
    async with _pool().connection() as conn:
        await conn.execute(
            """INSERT INTO user_preferences (owner, alert_preferences) VALUES (%s, %s)
               ON CONFLICT (owner) DO UPDATE SET alert_preferences = EXCLUDED.alert_preferences, updated_at = now()""",
            (caller.reporter_hash, Jsonb(prefs)),
        )
    return prefs


# ── Watched areas ────────────────────────────────────────────────────

SUB_COLUMNS = """subscription_id, region, label, radius_km, min_severity,
                 ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lon"""


def _subscription(r: dict) -> dict:
    out = {
        "subscription_id": str(r["subscription_id"]),
        "region": r["region"],
        "label": r["label"],
        "center": {"lat": r["lat"], "lon": r["lon"], "frame": "WGS84"},
        "radius_km": r["radius_km"],
        "min_severity": r["min_severity"],
    }
    return {k: v for k, v in out.items() if v is not None}


class SubscriptionIn(BaseModel):
    region: Literal["US"] = "US"
    label: str | None = Field(default=None, max_length=64)
    center: GeoPointIn
    radius_km: float = Field(gt=0, le=500)
    min_severity: Severity = "medium"


@router.get("/subscriptions")
async def list_subscriptions(caller: User):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(f"SELECT {SUB_COLUMNS} FROM subscriptions WHERE owner = %s AND kind = 'area' "
                          "ORDER BY created_at", (caller.reporter_hash,))
        return [_subscription(r) for r in await cur.fetchall()]


@router.post("/subscriptions", status_code=201)
async def create_subscription(body: SubscriptionIn, caller: User):
    async with _pool().connection() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        await cur.execute("SELECT count(*) AS n FROM subscriptions WHERE owner = %s AND kind = 'area'",
                          (caller.reporter_hash,))
        if (await cur.fetchone())["n"] >= MAX_AREAS:
            raise HTTPException(409, f"at most {MAX_AREAS} areas")
        await cur.execute(
            f"""INSERT INTO subscriptions (owner, region, label, center, radius_km, min_severity)
                VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s, %s)
                RETURNING {SUB_COLUMNS}""",
            (caller.reporter_hash, body.region, (body.label or "").strip() or None,
             body.center.lon, body.center.lat, body.radius_km, body.min_severity),
        )
        return _subscription(await cur.fetchone())


@router.delete("/subscriptions/{subscription_id}", status_code=204)
async def delete_subscription(subscription_id: uuid.UUID, caller: User):
    async with _pool().connection() as conn:
        cur = await conn.execute(
            "DELETE FROM subscriptions WHERE subscription_id = %s AND owner = %s AND kind = 'area'",
            (subscription_id, caller.reporter_hash))
    if cur.rowcount == 0:
        raise HTTPException(404, "no such area")
    return Response(status_code=204)


# ── Near me ──────────────────────────────────────────────────────────

class NearMeIn(BaseModel):
    center: GeoPointIn
    radius_km: float = Field(gt=0, le=500)


@router.put("/me/near-me", status_code=204)
async def put_near_me(body: NearMeIn, caller: User):
    """The area around the phone, so pushes match what Home shows. Stored at ~1 km
    precision: enough to decide who to warn, too coarse to track anyone.

    Pushes for it start at medium severity (Home still lists the low ones): minor
    statements shouldn't buzz a phone. Critical always gets through."""
    lat, lon = round(body.center.lat, 2), round(body.center.lon, 2)
    async with _pool().connection() as conn:
        await conn.execute(
            """INSERT INTO subscriptions (owner, kind, label, center, radius_km, min_severity)
               VALUES (%s, 'near_me', 'Near me', ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s, 'medium')
               ON CONFLICT (owner) WHERE kind = 'near_me' DO UPDATE
               SET center = EXCLUDED.center, radius_km = EXCLUDED.radius_km, updated_at = now()""",
            (caller.reporter_hash, lon, lat, body.radius_km),
        )
    return Response(status_code=204)


@router.delete("/me/near-me", status_code=204)
async def delete_near_me(caller: User):
    async with _pool().connection() as conn:
        await conn.execute("DELETE FROM subscriptions WHERE owner = %s AND kind = 'near_me'", (caller.reporter_hash,))
    return Response(status_code=204)
