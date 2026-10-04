"""Human review (contract `ReviewItem`; table review_queue, migration 0006).

The fusion pipeline inserts review_queue rows when it pauses an event for a human;
this module lists them for the reviewer console and records decisions. It never
resumes the pipeline itself — the pipeline picks up rows with status='decided'.
"""
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from moby.feeds.schema import Severity

from .auth import Caller, require_reviewer

router = APIRouter(prefix="/v1/review", tags=["review"])

Reviewer = Annotated[Caller, Depends(require_reviewer)]

QUEUE_SQL = """
SELECT q.event_id, q.reason, q.queued_at, q.adjudicator_rationale,
       e.source, e.region, e.hazard_type, e.observed_effect, e.severity, e.tier, e.confidence,
       e.specificity_score, e.distinct_reporter_count, e.confirm_count, e.deny_count,
       e.official_match_id, e.reviewer_decision, e.brief_status, e.title, e.description,
       e.first_reported_at, e.last_updated_at,
       ST_Y(e.location::geometry) AS lat, ST_X(e.location::geometry) AS lon, e.location_accuracy_m
FROM review_queue q JOIN events e USING (event_id)
WHERE q.status = 'open' AND (%(region)s::text IS NULL OR e.region = %(region)s)
-- Severity-floor items first (a single critical report fast-tracks to review), then oldest.
ORDER BY (q.reason = 'severity_floor') DESC, q.queued_at ASC
LIMIT 200
"""

REPORTS_SQL = """
SELECT event_id, client_event_id, hazard_type, observed_effect, severity, observed_at, note,
       captured_offline, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
       location_accuracy_m, reporter_hash
FROM reports WHERE event_id = ANY(%s) ORDER BY observed_at
"""


def _iso(v):
    return v.isoformat() if v is not None else None


def _event(row: dict) -> dict:
    event = {
        "event_id": str(row["event_id"]),
        "source": row["source"],
        "region": row["region"],
        "hazard_type": row["hazard_type"],
        "observed_effect": row["observed_effect"],
        "severity": row["severity"],
        "location": {"lat": row["lat"], "lon": row["lon"], "accuracy_m": row["location_accuracy_m"], "frame": "WGS84"},
        "first_reported_at": _iso(row["first_reported_at"]),
        "last_updated_at": _iso(row["last_updated_at"]),
        "tier": row["tier"],
        "confidence": row["confidence"],
        "specificity_score": row["specificity_score"],
        "distinct_reporter_count": row["distinct_reporter_count"],
        "confirm_count": row["confirm_count"],
        "deny_count": row["deny_count"],
        "official_match_id": str(row["official_match_id"]) if row["official_match_id"] else None,
        "reviewer_decision": row["reviewer_decision"],
        "brief_status": row["brief_status"],
        # Not in the contract's Event yet, but the console shows them.
        "title": row["title"],
        "description": row["description"],
    }
    return {k: v for k, v in event.items() if v is not None}


def _report(r: dict) -> dict:
    out = {
        "client_event_id": r["client_event_id"],
        "hazard_type": r["hazard_type"],
        "observed_effect": r["observed_effect"],
        "severity": r["severity"],
        "location": {"lat": r["lat"], "lon": r["lon"], "accuracy_m": r["location_accuracy_m"], "frame": "WGS84"},
        "observed_at": _iso(r["observed_at"]),
        "note": r["note"],
        "captured_offline": r["captured_offline"],
        # Lets a reviewer see "3 reports from 2 people" without exposing who.
        "reporter": r["reporter_hash"][:8],
    }
    return {k: v for k, v in out.items() if v is not None}


@router.get("/queue")
async def review_queue(_: Reviewer, region: Literal["US", "CN"] | None = None):
    from .app import _pool  # late import: app.py owns the pool and imports this module

    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(QUEUE_SQL, {"region": region})
        rows = await cur.fetchall()
        await cur.execute(REPORTS_SQL, ([r["event_id"] for r in rows],))
        reports = await cur.fetchall()
    by_event: dict = {}
    for rep in reports:
        by_event.setdefault(rep["event_id"], []).append(_report(rep))
    return [
        {
            "event_id": str(r["event_id"]),
            "event": _event(r),
            "queued_at": _iso(r["queued_at"]),
            "reason": r["reason"],
            "contributing_reports": by_event.get(r["event_id"], []),
            **({"adjudicator_rationale": r["adjudicator_rationale"]} if r["adjudicator_rationale"] else {}),
        }
        for r in rows
    ]


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject", "hold"]
    note: str | None = Field(default=None, max_length=500)
    override_severity: Severity | None = None


@router.post("/{event_id}/decision", status_code=204)
async def decide(event_id: uuid.UUID, body: DecisionIn, reviewer: Reviewer):
    from .app import _pool

    async with _pool().connection() as conn, conn.transaction():
        cur = await conn.execute(
            """UPDATE review_queue
               SET status = 'decided', decision = %(decision)s, decision_note = %(note)s,
                   override_severity = %(override)s, decided_by = %(by)s, decided_at = now()
               WHERE event_id = %(id)s AND status = 'open'""",
            {"decision": body.decision, "note": (body.note or "").strip() or None,
             "override": body.override_severity, "by": reviewer.reporter_hash, "id": event_id},
        )
        if cur.rowcount == 0:
            exists = await (await conn.execute(
                "SELECT status FROM review_queue WHERE event_id = %s", (event_id,))).fetchone()
            # Two reviewers deciding the same item: the second learns it's already done.
            raise HTTPException(409 if exists else 404, "already decided" if exists else "not in the review queue")
        await conn.execute("UPDATE events SET reviewer_decision = %s WHERE event_id = %s",
                           (body.decision, event_id))
    return Response(status_code=204)
