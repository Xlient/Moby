"""Bluetooth mesh relay (contract 0.7.0): the gateway boundary.

Phones with no signal pass compact records to nearby phones over Bluetooth. Any phone
that is online (a *gateway*) uploads the reports it heard with `POST /v1/mesh/sync`,
and downloads official alerts with `GET /v1/mesh/alerts` to spread them to phones
that are offline. The radio format lives in the app (`src/mesh/codec.ts`); this module
only sees its JSON mirror, `MeshRecord`.

Trust rules (plan §9):
- a mesh report is a community report like any other: unverified until fusion, and
  labelled as such;
- relays are recorded in `relayed_by` and never count as corroboration;
- `reporter_hash` is the originator's short, daily-rotating id, stored as `mesh:<hex>`
  so it can't collide with account-based hashes;
- free text never travels over the mesh; the reporter attaches it later, when their own
  phone reconnects (see `reports.submit_report`, which upgrades the mesh copy).

SOS (hazard code 6): "someone near here asked for help", from the "I need help" screen.
Stored in `sos_signals`, never in `reports`: a person is not a hazard, so an SOS is never
fused into an event or pushed as an alert. Severity carries the state: critical = help,
low = "I'm safe now" (from the same daily reporter id). Reviewers see them in the console
(`GET /v1/review/sos`).
"""
import hashlib
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from moby.alerts.preferences import AlertPreferences, alerts_near

from .alerts import to_alert
from .auth import Caller, require_user
from .reports import MAX_CLOCK_SKEW, MAX_REPORT_AGE, MAX_REPORTS_PER_HOUR

router = APIRouter(prefix="/v1/mesh", tags=["mesh"])

# Codes used on the air. Order matters: it is the wire format (src/mesh/codec.ts).
HAZARD_CODES = ["flood", "fire", "earthquake", "storm", "landslide", "other"]
SEVERITY_CODES = ["low", "medium", "high", "critical"]
# Appended after the hazards, so older phones simply drop it (wire format: append only).
SOS_CODE = 6
SOS_STATUS = {3: "help", 0: "safe"}
# A person in trouble may resend; a phone spamming SOS is something else.
MAX_SOS_PER_HOUR = 6

# Phones stop relaying after this many hops; anything higher was tampered with.
MAX_HOPS = 8
# One gateway can't flood the database, however many records it heard.
MAX_SYNC_PER_GATEWAY_PER_HOUR = 500
# Locations travel rounded to 1e-4 degrees (about 11 m).
MESH_LOCATION_ACCURACY_M = 11.0


def alert_key(event_id: str) -> str:
    return hashlib.sha256(f"alert:{event_id}".encode()).digest()[:8].hex()


class MeshRecordIn(BaseModel):
    event_id: str = Field(pattern=r"^[0-9a-f]{16}$")
    hazard_type: int = Field(ge=0, le=255)
    lat_e6: int
    lon_e6: int
    severity: int = Field(ge=0, le=255)
    confidence: int | None = Field(default=None, ge=0, le=255)
    hop_count: int = Field(ge=0, le=255)
    timestamp: int
    reporter_hash: str = Field(pattern=r"^[0-9a-f]{8}$")
    relayed_by: list[str] = Field(default_factory=list, max_length=32)


class MeshSyncIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=128)
    records: list[MeshRecordIn] = Field(max_length=200)


def _problem(rec: MeshRecordIn, now: datetime) -> str | None:
    """Why a record can't be stored, or None. Stable reason codes; the app logs them."""
    if rec.hazard_type == SOS_CODE:
        if rec.severity not in SOS_STATUS:
            return "unknown_sos_status"
    elif rec.hazard_type >= len(HAZARD_CODES):
        return "unknown_hazard_type"
    if rec.severity >= len(SEVERITY_CODES):
        return "unknown_severity"
    if not (-90_000_000 <= rec.lat_e6 <= 90_000_000 and -180_000_000 <= rec.lon_e6 <= 180_000_000):
        return "bad_location"
    if rec.hop_count > MAX_HOPS:
        return "too_many_hops"
    observed = datetime.fromtimestamp(rec.timestamp, timezone.utc)
    if observed > now + MAX_CLOCK_SKEW:
        return "in_the_future"
    if observed < now - MAX_REPORT_AGE:
        return "too_old"
    return None


def _pool():
    from .app import _pool as app_pool  # late import: app.py owns the pool and imports this module
    return app_pool()


@router.post("/sync")
async def sync(body: MeshSyncIn, caller: Annotated[Caller, Depends(require_user)]):
    """Store reports a gateway heard over the mesh. Idempotent on event_id: a record seen
    again (through another relay, or a retry) only adds the gateway to `relayed_by`."""
    now = datetime.now(timezone.utc)
    acknowledged: list[str] = []
    rejected: list[dict[str, str]] = []
    async with _pool().connection() as conn:
        async with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """SELECT (SELECT count(*) FROM reports
                           WHERE source = 'mesh' AND %(g)s = ANY(relayed_by) AND received_at > now() - interval '1 hour')
                        + (SELECT count(*) FROM sos_signals
                           WHERE %(g)s = ANY(relayed_by) AND received_at > now() - interval '1 hour') AS n""",
                {"g": caller.reporter_hash},
            )
            budget = MAX_SYNC_PER_GATEWAY_PER_HOUR - (await cur.fetchone())["n"]
            for rec in body.records:
                if (reason := _problem(rec, now)) is not None:
                    rejected.append({"event_id": rec.event_id, "reason": reason})
                    continue
                originator = f"mesh:{rec.reporter_hash}"
                if rec.hazard_type == SOS_CODE:
                    reason, inserted = await _store_sos(cur, rec, originator, caller.reporter_hash, budget)
                    if reason:
                        rejected.append({"event_id": rec.event_id, "reason": reason})
                        continue
                    budget -= int(inserted)
                    acknowledged.append(rec.event_id)
                    continue
                await cur.execute(
                    """SELECT count(*) AS n FROM reports
                       WHERE reporter_hash = %s AND received_at > now() - interval '1 hour'
                         AND mesh_key <> %s""",
                    (originator, rec.event_id),
                )
                if (await cur.fetchone())["n"] >= MAX_REPORTS_PER_HOUR:
                    rejected.append({"event_id": rec.event_id, "reason": "rate_limited"})
                    continue
                if budget <= 0:
                    rejected.append({"event_id": rec.event_id, "reason": "gateway_rate_limited"})
                    continue
                relays = sorted({*rec.relayed_by[:31], caller.reporter_hash})
                await cur.execute(
                    """INSERT INTO reports (client_event_id, mesh_key, source, reporter_hash, relayed_by,
                                            hazard_type, severity, location, location_accuracy_m,
                                            observed_at, captured_offline)
                       VALUES (%(cid)s, %(key)s, 'mesh', %(originator)s, %(relays)s, %(hazard)s, %(severity)s,
                               ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(acc)s,
                               %(observed_at)s, true)
                       ON CONFLICT (mesh_key) WHERE mesh_key IS NOT NULL DO UPDATE
                       SET relayed_by = ARRAY(SELECT DISTINCT unnest(reports.relayed_by || EXCLUDED.relayed_by))
                       RETURNING (xmax = 0) AS inserted""",
                    {
                        "cid": f"mesh:{rec.event_id}", "key": rec.event_id, "originator": originator,
                        "relays": relays, "hazard": HAZARD_CODES[rec.hazard_type],
                        "severity": SEVERITY_CODES[rec.severity],
                        "lat": rec.lat_e6 / 1e6, "lon": rec.lon_e6 / 1e6, "acc": MESH_LOCATION_ACCURACY_M,
                        "observed_at": datetime.fromtimestamp(rec.timestamp, timezone.utc),
                    },
                )
                if (await cur.fetchone())["inserted"]:
                    budget -= 1
                acknowledged.append(rec.event_id)
    return {"acknowledged": acknowledged, "rejected": rejected}


async def _store_sos(cur, rec: MeshRecordIn, originator: str, gateway: str, budget: int) -> tuple[str | None, bool]:
    """Stores one SOS (or "I'm safe"). Returns (reject reason, whether a new row was made)."""
    await cur.execute(
        """SELECT count(*) AS n FROM sos_signals
           WHERE reporter_hash = %s AND received_at > now() - interval '1 hour' AND mesh_key <> %s""",
        (originator, rec.event_id),
    )
    if (await cur.fetchone())["n"] >= MAX_SOS_PER_HOUR:
        return "rate_limited", False
    if budget <= 0:
        return "gateway_rate_limited", False
    await cur.execute(
        """INSERT INTO sos_signals (mesh_key, reporter_hash, status, location, location_accuracy_m,
                                    sent_at, hop_count, relayed_by)
           VALUES (%(key)s, %(originator)s, %(status)s,
                   ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(acc)s,
                   %(sent_at)s, %(hops)s, %(relays)s)
           ON CONFLICT (mesh_key) DO UPDATE
           SET relayed_by = ARRAY(SELECT DISTINCT unnest(sos_signals.relayed_by || EXCLUDED.relayed_by)),
               hop_count = LEAST(sos_signals.hop_count, EXCLUDED.hop_count)
           RETURNING (xmax = 0) AS inserted""",
        {
            "key": rec.event_id, "originator": originator, "status": SOS_STATUS[rec.severity],
            "lat": rec.lat_e6 / 1e6, "lon": rec.lon_e6 / 1e6, "acc": MESH_LOCATION_ACCURACY_M,
            "sent_at": datetime.fromtimestamp(rec.timestamp, timezone.utc), "hops": rec.hop_count,
            "relays": sorted({*rec.relayed_by[:31], gateway}),
        },
    )
    return None, (await cur.fetchone())["inserted"]


@router.get("/alerts")
async def mesh_alerts(
    _caller: Annotated[Caller, Depends(require_user)],
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    radius_km: Annotated[float, Query(gt=0, le=300)] = 100,
):
    """Official alerts near a gateway, compact, for it to spread to phones that are
    offline. Only official ones: community reports travel as reports, not as alerts."""
    # Marine products included: tsunami warnings matter most where there's no signal.
    prefs = AlertPreferences.from_dict({"community_reports": "off", "include_marine": True})
    async with _pool().connection() as conn:
        rows = await alerts_near(conn, lat, lon, radius_km, prefs, min_tier=2, limit=20)
    records = []
    for row in rows:
        alert = to_alert(row)
        records.append({
            "event_id": alert_key(alert["event_id"]),
            "hazard_type": HAZARD_CODES.index(alert["hazard_type"]) if alert["hazard_type"] in HAZARD_CODES else 5,
            "lat_e6": round(alert["location"]["lat"] * 1e6),
            "lon_e6": round(alert["location"]["lon"] * 1e6),
            "severity": SEVERITY_CODES.index(alert["severity"]),
            "hop_count": 0,
            "timestamp": int(datetime.fromisoformat(alert["issued_at"]).timestamp()),
            "reporter_hash": "00000000",
            # Not on the air (too big); the gateway's own phone shows it, and so do docs/logs.
            "headline": alert.get("headline"),
            "expires_at": alert.get("expires_at"),
        })
    return {"records": records}
