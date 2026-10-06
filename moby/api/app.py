"""HTTP API (runs in the Serverless Endpoint next to the database and the poller).

Public, read-only:
  GET  /healthz                     liveness + database + feed freshness
  GET  /v1/alerts                   active alerts near a point, filtered by preferences
  GET  /v1/events/{event_id}        one event (contract `Alert` shape); also /v1/alerts/{alert_id}
  GET  /v1/events/{event_id}/reports  community reports behind an event (coarse, no notes)
  GET  /v1/events/{event_id}/brief  situational brief (200), or 202 while it is being written
  GET  /v1/config                   client feature flags
  GET  /v1/guidance/manifest, /v1/guidance/cards  published offline guidance (see guidance.py)

Signed-in users (Firebase ID token):
  POST /v1/reports                  submit a ground report (write-first, 202)
  GET  /v1/reports/{client_event_id} status of one of your own reports
  POST /v1/me/devices               register this phone's push token (DELETE on sign-out)
  GET|PUT /v1/me/alert-preferences  what may notify you (critical always does)
  PUT|DELETE /v1/me/near-me         the area around the phone (~1 km precision)
  GET|POST /v1/subscriptions, DELETE /v1/subscriptions/{id}  saved areas

Reviewer console: /console/ (static page; Google sign-in via Firebase)

Reviewers (Firebase custom claim reviewer=true):
  GET  /v1/review/queue             events paused for human review
  POST /v1/review/{event_id}/decision  approve / reject / hold

Internal (Bearer MOBY_SERVICE_TOKEN; used by Serverless Jobs, never by the app):
  GET  /internal/v1/embedding-queue events still missing an embedding
  POST /internal/v1/embeddings      store embeddings computed by the embed job
  GET  /internal/v1/backup          stream a pg_dump of the database (backup job)

Jobs talk to the database only through these routes, so Postgres is never exposed on
the network and jobs need no database credentials.

    uv run uvicorn moby.api.app:app --reload
"""
import asyncio
import hmac
import os
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row
from pydantic import BaseModel, Field
from psycopg_pool import AsyncConnectionPool

from moby.alerts.preferences import AlertPreferences, alerts_near
from moby.config import get_settings
from moby.db import make_pool
from moby.feeds.poller import FEEDS, health as feeds_health
from moby.feeds.schema import Severity
from moby.llm import EMBEDDING_DIM

from .alerts import to_alert
from .reports import router as reports_router
from .guidance import router as guidance_router
from .me import router as me_router
from .review import router as review_router

pool: AsyncConnectionPool | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global pool
    pool = make_pool(min_size=1, max_size=8)
    await pool.open()
    try:
        yield
    finally:
        await pool.close()


app = FastAPI(title="Moby early-warning API", version="0.5.0", lifespan=lifespan)
app.include_router(reports_router)
app.include_router(review_router)
app.include_router(me_router)
app.include_router(guidance_router)

# ── Reviewer console (static page; it signs in with Firebase and calls /v1/review) ──
CONSOLE_DIR = Path(__file__).resolve().parent.parent / "console"


@app.get("/console/config", include_in_schema=False)
async def console_config():
    # Public Firebase web config (identifiers, not secrets) so the page can sign in.
    s = get_settings()
    return {
        "auth_disabled": s.moby_auth_disabled,
        "firebase": {"apiKey": s.firebase_web_api_key, "authDomain": s.firebase_auth_domain,
                     "projectId": s.firebase_project_id},
    }


app.mount("/console", StaticFiles(directory=CONSOLE_DIR, html=True), name="console")


def _pool() -> AsyncConnectionPool:
    assert pool is not None
    return pool


# ── Public ───────────────────────────────────────────────────────────────────

@app.get("/healthz")
async def healthz():
    try:
        async with _pool().connection() as conn:
            await conn.execute("SELECT 1")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"database unavailable: {type(e).__name__}") from e
    ok, lines = await feeds_health(list(FEEDS))
    # Stale feeds are reported but don't fail liveness: the API still serves the
    # last good data, which beats restarting the whole endpoint.
    # "ephemeral" means the endpoint fell back to local disk (see deploy/endpoint/start.sh).
    return {"status": "ok", "storage": os.environ.get("MOBY_STORAGE", "persistent"),
            "feeds_fresh": ok, "feeds": lines}


@app.get("/v1/alerts")
async def get_alerts(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    radius_km: Annotated[float, Query(gt=0, le=500)] = 50,
    min_tier: Annotated[int, Query(ge=0, le=2)] = 2,
    hazard_types: Annotated[str | None, Query(description="comma-separated HazardType values")] = None,
    min_severity: Severity | None = None,
    include_marine: bool | None = None,
):
    prefs = AlertPreferences.from_dict({
        "hazard_types": hazard_types.split(",") if hazard_types else None,
        "min_severity": min_severity,
        "include_marine": include_marine,
    })
    async with _pool().connection() as conn:
        rows = await alerts_near(conn, lat, lon, radius_km, prefs, min_tier=min_tier)
    return {"alerts": [to_alert(r) for r in rows]}


@app.get("/v1/events/{event_id}")
@app.get("/v1/alerts/{event_id}")  # contract /alerts/{alert_id}: alert_id is the event_id
async def get_event(event_id: uuid.UUID):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT event_id, source, source_feed, external_id, hazard_type, product, marine, severity, tier,
                      title, description, alert_headline, alert_body, distinct_reporter_count,
                      first_reported_at, last_updated_at, expires_at, raw_payload,
                      ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
               FROM events WHERE event_id = %s""",
            (event_id,),
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(404, "event not found")
    return to_alert(row)


@app.get("/v1/events/{event_id}/reports")
async def event_reports(event_id: uuid.UUID):
    """Community reports fused into an event, for the alert detail screen.

    Public, so deliberately coarse: no note (free text can identify people), no
    reporter id, and position only as a distance from the event rounded to 100 m.
    """
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute("SELECT 1 FROM events WHERE event_id = %s", (event_id,))
        if await cur.fetchone() is None:
            raise HTTPException(404, "event not found")
        await cur.execute(
            """SELECT r.hazard_type, r.observed_effect, r.severity, r.observed_at, r.captured_offline, r.source,
                      round(ST_Distance(r.location, e.location) / 100) * 100 AS distance_m
               FROM reports r JOIN events e USING (event_id)
               WHERE r.event_id = %s AND r.fusion_status = 'fused'
               ORDER BY r.observed_at DESC LIMIT 50""",
            (event_id,),
        )
        rows = await cur.fetchall()
        await cur.execute(
            "SELECT count(DISTINCT reporter_hash) AS people FROM reports WHERE event_id = %s AND fusion_status = 'fused'",
            (event_id,),
        )
        people = (await cur.fetchone())["people"]
    return {
        "event_id": str(event_id),
        "distinct_reporter_count": people,
        "reports": [
            {
                "hazard_type": r["hazard_type"],
                **({"observed_effect": r["observed_effect"]} if r["observed_effect"] else {}),
                "severity": r["severity"],
                "observed_at": r["observed_at"].isoformat(),
                "distance_from_event_m": int(r["distance_m"]),
                "captured_offline": r["captured_offline"],
                "via_mesh": r["source"] == "mesh",
            }
            for r in rows
        ],
    }


@app.get("/v1/events/{event_id}/brief")
async def event_brief(event_id: uuid.UUID):
    """Contract 4. 200 with the brief, 202 while the situational_brief job is working on
    it. A brief that was never requested or failed is a 404: the app shows the alert
    on its own and never waits on this route."""
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT e.brief_status, b.generated_at, b.model, b.summary, b.likely_progression, b.exposed_areas,
                      b.official_guidance, b.uncertainty, b.sources
               FROM events e LEFT JOIN briefs b USING (event_id) WHERE e.event_id = %s""",
            (event_id,),
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(404, "event not found")
    if row["summary"] is not None:
        brief = {
            "event_id": str(event_id),
            "generated_at": row["generated_at"].isoformat(),
            "model": row["model"],
            "summary": row["summary"],
            "likely_progression": row["likely_progression"],
            "exposed_areas": row["exposed_areas"],
            "official_guidance": row["official_guidance"],
            "uncertainty": row["uncertainty"],
            "sources": row["sources"],
        }
        return {k: v for k, v in brief.items() if v is not None}
    if row["brief_status"] == "pending":
        return JSONResponse({"status": "pending", "retry_after_seconds": 15}, status_code=202)
    raise HTTPException(404, "no brief for this event")


@app.get("/v1/config")
async def get_config():
    # Feature-flag discipline (plan v3 §1): everything past Week 4 ships off.
    return {
        "min_supported_client": "0.1.0",
        "flags": {
            "situational_brief": False,
            "cascade_analysis": False,
            "offline_guidance_cards": True,   # Week 5: synced cards + built-in fallbacks
            "on_device_assistant": False,
            "mesh_relay": False,
            "proximity_confirmation": False,
            "early_tier_opt_in": False,
        },
    }


# ── Internal (jobs) ──────────────────────────────────────────────────────────

def require_service_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = os.environ.get("MOBY_SERVICE_TOKEN", "")
    if not expected:
        raise HTTPException(403, "internal API disabled (MOBY_SERVICE_TOKEN not set)")
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given, expected):
        raise HTTPException(401, "bad service token")


Internal = Annotated[None, Depends(require_service_token)]


def embedding_text(row: dict) -> str:
    """What gets embedded for fusion's similarity stage: kind, headline, details."""
    parts = [row.get("product") or row["hazard_type"], row.get("title") or "", (row.get("description") or "")[:1500]]
    return ". ".join(p.strip() for p in parts if p and p.strip())


@app.get("/internal/v1/embedding-queue")
async def embedding_queue(_: Internal, limit: Annotated[int, Query(ge=1, le=256)] = 64):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT event_id, hazard_type, product, title, description FROM events
               WHERE embedding IS NULL AND (expires_at IS NULL OR expires_at > now())
               ORDER BY first_reported_at DESC LIMIT %s""",
            (limit,),
        )
        rows = await cur.fetchall()
    return {"items": [{"event_id": str(r["event_id"]), "text": embedding_text(r)} for r in rows],
            "dimensions": EMBEDDING_DIM}


class EmbeddingIn(BaseModel):
    event_id: uuid.UUID
    embedding: list[float] = Field(min_length=EMBEDDING_DIM, max_length=EMBEDDING_DIM)


@app.post("/internal/v1/embeddings")
async def store_embeddings(_: Internal, items: list[EmbeddingIn]):
    async with _pool().connection() as conn, conn.cursor() as cur:
        await cur.executemany(
            "UPDATE events SET embedding = %s::vector WHERE event_id = %s",
            [(str(i.embedding), i.event_id) for i in items],
        )
    return {"stored": len(items)}


@app.get("/internal/v1/backup")
async def backup(_: Internal):
    """Stream `pg_dump --format=custom` (restore with pg_restore)."""
    if shutil.which("pg_dump") is None:
        raise HTTPException(503, "pg_dump is not installed here (it ships in the endpoint image)")
    proc = await asyncio.create_subprocess_exec(
        "pg_dump", "--format=custom", "--no-owner", get_settings().database_url,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )

    async def stream():
        assert proc.stdout is not None
        while chunk := await proc.stdout.read(1 << 16):
            yield chunk
        if await proc.wait() != 0:
            err = (await proc.stderr.read()).decode()[:300] if proc.stderr else ""
            raise RuntimeError(f"pg_dump failed: {err}")

    return StreamingResponse(stream(), media_type="application/octet-stream",
                             headers={"Content-Disposition": 'attachment; filename="moby.dump"'})


