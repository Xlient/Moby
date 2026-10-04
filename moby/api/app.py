"""HTTP API (runs in the Serverless Endpoint next to the database and the poller).

Public, read-only:
  GET  /healthz                     liveness + database + feed freshness
  GET  /v1/alerts                   active alerts near a point, filtered by preferences
  GET  /v1/events/{event_id}        one event (contract `Alert` shape)
  GET  /v1/config                   client feature flags

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
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
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


app = FastAPI(title="Moby early-warning API", version="0.4.0", lifespan=lifespan)


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
async def get_event(event_id: uuid.UUID):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT event_id, source_feed, external_id, hazard_type, product, marine, severity, tier,
                      title, description, first_reported_at, last_updated_at, expires_at, raw_payload,
                      ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
               FROM events WHERE event_id = %s""",
            (event_id,),
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(404, "event not found")
    return to_alert(row)


@app.get("/v1/config")
async def get_config():
    # Feature-flag discipline (plan v3 §1): everything past Week 4 ships off.
    return {
        "min_supported_client": "0.1.0",
        "flags": {
            "situational_brief": False,
            "cascade_analysis": False,
            "offline_guidance_cards": False,
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


