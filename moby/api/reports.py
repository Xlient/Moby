"""Ground reports (contract 0.5.0): write-first intake.

`POST /v1/reports` validates the submission, stores it with fusion_status='pending'
and returns 202 — a 202 means durably received. The fusion pipeline (LangGraph,
owned separately) consumes pending rows and sets fusion_status, event_id and
structured. Retries with the same client_event_id are idempotent.
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from pydantic import BaseModel, Field, field_validator

from moby.feeds.schema import HazardType, Severity

from .auth import Caller, require_user

router = APIRouter(prefix="/v1/reports", tags=["reports"])

# Offline-captured reports may sit on a phone for days without signal.
MAX_REPORT_AGE = timedelta(days=7)
# Allowed clock skew for reports stamped slightly in the future by a phone's clock.
MAX_CLOCK_SKEW = timedelta(minutes=5)
# Basic flood protection; real Sybil dampening is the fusion pipeline's job.
MAX_REPORTS_PER_HOUR = 30

ObservedEffect = Literal[
    "rising_water", "structural_damage", "smoke_or_fire_visible", "ground_shaking", "blocked_road", "other",
]


class GeoPointIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100_000)
    # Only WGS84 is enabled (US region); GCJ-02 arrives with the CN region.
    frame: Literal["WGS84"] = "WGS84"


class ReportIn(BaseModel):
    client_event_id: str = Field(min_length=8, max_length=64)
    hazard_type: HazardType
    observed_effect: ObservedEffect | None = None
    severity: Severity
    location: GeoPointIn
    observed_at: datetime
    note: str | None = Field(default=None, max_length=1000)
    captured_offline: bool = False

    @field_validator("observed_at")
    @classmethod
    def plausible_time(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("observed_at must include a timezone")
        now = datetime.now(timezone.utc)
        if v > now + MAX_CLOCK_SKEW:
            raise ValueError("observed_at is in the future")
        if v < now - MAX_REPORT_AGE:
            raise ValueError("observed_at is more than 7 days ago")
        return v

    @field_validator("note")
    @classmethod
    def strip_note(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


def _accepted(row: dict) -> dict:
    out = {
        "client_event_id": row["client_event_id"],
        "report_id": str(row["report_id"]),
        "status": row["fusion_status"],
    }
    if row.get("event_id"):
        out["event_id"] = str(row["event_id"])
    if row.get("tier") is not None:
        out["tier"] = row["tier"]
    return out


STATUS_SQL = """
SELECT r.report_id, r.client_event_id, r.fusion_status, r.event_id, r.reporter_hash, e.tier
FROM reports r LEFT JOIN events e ON e.event_id = r.event_id
WHERE r.client_event_id = %s
"""


def _pool():
    from .app import _pool as app_pool  # late import: app.py owns the pool and imports this module
    return app_pool()


@router.post("", status_code=202)
async def submit_report(report: ReportIn, caller: Annotated[Caller, Depends(require_user)]):
    async with _pool().connection() as conn:
        async with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """SELECT count(*) AS n FROM reports
                   WHERE reporter_hash = %s AND received_at > now() - interval '1 hour'""",
                (caller.reporter_hash,),
            )
            if (await cur.fetchone())["n"] >= MAX_REPORTS_PER_HOUR:
                return JSONResponse({"detail": "too many reports; try again later"}, status_code=429,
                                    headers={"Retry-After": "600"})
            await cur.execute(
                """INSERT INTO reports (client_event_id, reporter_hash, hazard_type, observed_effect, severity,
                                        location, location_accuracy_m, observed_at, captured_offline, note)
                   VALUES (%(cid)s, %(reporter)s, %(hazard)s, %(effect)s, %(severity)s,
                           ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(acc)s,
                           %(observed_at)s, %(offline)s, %(note)s)
                   ON CONFLICT (client_event_id) DO NOTHING""",
                {
                    "cid": report.client_event_id, "reporter": caller.reporter_hash,
                    "hazard": report.hazard_type, "effect": report.observed_effect, "severity": report.severity,
                    "lat": report.location.lat, "lon": report.location.lon, "acc": report.location.accuracy_m,
                    "observed_at": report.observed_at, "offline": report.captured_offline, "note": report.note,
                },
            )
            await cur.execute(STATUS_SQL, (report.client_event_id,))
            row = await cur.fetchone()
    if row["reporter_hash"] != caller.reporter_hash:
        raise HTTPException(409, "client_event_id already used")
    return _accepted(row)


@router.get("/{client_event_id}")
async def report_status(client_event_id: str, caller: Annotated[Caller, Depends(require_user)]):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(STATUS_SQL, (client_event_id,))
        row = await cur.fetchone()
    # Someone else's report is indistinguishable from a missing one.
    if row is None or row["reporter_hash"] != caller.reporter_hash:
        raise HTTPException(404, "report not found")
    return _accepted(row)


