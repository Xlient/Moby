"""HTTP API (runs in the Serverless Endpoint next to the database and the poller).

Public, read-only:
  GET  /healthz                     liveness + database + feed freshness
  GET  /v1/alerts                   active alerts near a point, filtered by preferences
  GET  /v1/alerts/areas             the same alerts' areas as GeoJSON, for the map
  GET  /v1/events/{event_id}        one event (contract `Alert` shape); also /v1/alerts/{alert_id}
  GET  /v1/events/{event_id}/reports  community reports behind an event (coarse, no notes)
  GET  /v1/events/{event_id}/brief  situational brief (200), or 202 while it is being written
  GET  /v1/events/{event_id}/explain  'What this means for you' (Nemotron Super), 202 while written
  GET  /v1/config                   client feature flags
  GET  /v1/demo/hot-zones, /v1/demo/replay  trying Moby away from a disaster (see demo.py)
  GET  /v1/guidance/manifest, /v1/guidance/cards  published offline guidance (see guidance.py)

Signed-in users (Firebase ID token):
  POST /v1/ask                      Ask Moby: a cited answer from official sources, or none
  POST /v1/trips/brief              "Before you go": alerts and reports around a destination, explained
  POST /v1/reports                  submit a ground report (write-first, 202)
  GET  /v1/reports/{client_event_id} status of one of your own reports
  POST /v1/me/devices               register this phone's push token (DELETE on sign-out)
  GET|PUT /v1/me/alert-preferences  what may notify you (critical always does)
  PUT|DELETE /v1/me/near-me         the area around the phone (~1 km precision)
  GET|POST /v1/subscriptions, DELETE /v1/subscriptions/{id}  saved areas
  POST /v1/flags                    "This looks wrong" on AI output or a community report

Reviewer console: /console/ (static page; Google sign-in via Firebase)

Reviewers (Firebase custom claim reviewer=true):
  GET  /v1/review/queue             events paused for human review
  POST /v1/review/{event_id}/decision  approve / reject / hold
  GET  /v1/review/flags             open "This looks wrong" flags; POST .../{flag_id}/resolve

Internal (Bearer MOBY_SERVICE_TOKEN; used by Serverless Jobs, never by the app):
  GET  /internal/v1/embedding-queue events still missing an embedding
  POST /internal/v1/embeddings      store embeddings computed by the embed job
  GET  /internal/v1/backup          stream a pg_dump of the database (backup job)

Jobs talk to the database only through these routes, so Postgres is never exposed on
the network and jobs need no database credentials.

    uv run uvicorn moby.api.app:app --reload
"""
import asyncio
import json
import hmac
import logging
import os
import shutil
import uuid
from datetime import date, datetime, timedelta, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row
from pydantic import BaseModel, Field, model_validator
from psycopg_pool import AsyncConnectionPool

from moby.alerts.preferences import AlertPreferences, alerts_near
from moby.config import get_settings
from moby.ai import alert_text
from moby.db import make_pool
from moby.feeds.poller import FEEDS, health as feeds_health
from moby.feeds.schema import Severity
from moby.llm import EMBEDDING_DIM

from moby.ai import ask, budget, explain, localize, trip
from moby.graph.brief_queries import TIMELINE_EVENT_SQL, TIMELINE_REPORTS_SQL, build_timeline
from moby.graph.brief_queries import VIEW_SQL as BRIEF_ON_VIEW_SQL

from .alerts import SOURCE_ATTRIBUTION, to_alert
from .auth import Caller, require_user
from .demo import router as demo_router
from .flags import router as flags_router
from .mesh import router as mesh_router
from .reports import router as reports_router
from .appcheck import app_check_middleware
from .guidance import router as guidance_router
from .routes import router as routes_router
from .me import router as me_router
from .privacy import router as privacy_router
from .review import router as review_router

pool: AsyncConnectionPool | None = None

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"   # as the workers' basicConfig


def configure_logging() -> None:
    """Send moby.* INFO lines (trip brief attempts, Ask Moby, explanations…) to stderr.
    uvicorn sets up only its own loggers, so under a plain `uvicorn moby.api.app:app`
    (deploy/endpoint/start.sh) ours fell through to Python's last-resort handler, which
    prints warnings and errors only. Left alone when a --log-config gave the root logger
    handlers, so nothing is logged twice."""
    moby_log = logging.getLogger("moby")
    if moby_log.handlers or logging.getLogger().handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    moby_log.addHandler(handler)
    moby_log.setLevel(logging.INFO)


configure_logging()


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
# Only the official signed app (Play Integrity) may call /v1/* — see appcheck.py.
app.middleware("http")(app_check_middleware)
# Local web development only (README "Run it locally"): the phone app needs no CORS.
if cors := os.environ.get("MOBY_CORS_ORIGINS"):
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(CORSMiddleware, allow_origins=cors.split(","), allow_methods=["*"], allow_headers=["*"])
app.include_router(reports_router)
app.include_router(mesh_router)
app.include_router(review_router)
app.include_router(me_router)
app.include_router(privacy_router)
app.include_router(guidance_router)
app.include_router(routes_router)
app.include_router(demo_router)
app.include_router(flags_router)

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
            ai_usage = await budget.usage_today(conn)   # also proves the database answers
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"database unavailable: {type(e).__name__}") from e
    ok, lines = await feeds_health([*FEEDS, "cap", "centers"])  # CAP is reported but never makes feeds_fresh false
    # Stale feeds are reported but don't fail liveness: the API still serves the
    # last good data, which beats restarting the whole endpoint.
    # "ephemeral" means the endpoint fell back to local disk (see deploy/endpoint/start.sh).
    return {"status": "ok", "storage": os.environ.get("MOBY_STORAGE", "persistent"),
            "feeds_fresh": ok, "feeds": lines, "ai_usage_today": ai_usage}


@app.get("/v1/alerts")
async def get_alerts(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    radius_km: Annotated[float, Query(gt=0, le=500)] = 50,
    min_tier: Annotated[int, Query(ge=0, le=2)] = 2,
    hazard_types: Annotated[str | None, Query(description="comma-separated HazardType values")] = None,
    min_severity: Severity | None = None,
    include_marine: bool | None = None,
    community_reports: Literal["off", "corroborated", "all"] | None = None,
    lang: Annotated[str | None, Query(max_length=16, description="phone language, e.g. ja-JP")] = None,
):
    """Active alerts near a point. With `lang`, official alerts read in the phone's language
    where a translation is already cached (opening one makes it: GET /v1/alerts/{id})."""
    prefs = AlertPreferences.from_dict({
        "hazard_types": hazard_types.split(",") if hazard_types else None,
        "min_severity": min_severity,
        "include_marine": include_marine,
        "community_reports": community_reports,
    })
    async with _pool().connection() as conn:
        rows = await alerts_near(conn, lat, lon, radius_km, prefs, min_tier=min_tier)
    return {"alerts": [to_alert(r, lang) for r in rows]}


@app.get("/v1/alerts/areas")
async def alert_areas(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    radius_km: Annotated[float, Query(gt=0, le=500)] = 50,
    min_tier: Annotated[int, Query(ge=0, le=2)] = 2,
    hazard_types: Annotated[str | None, Query(description="comma-separated HazardType values")] = None,
    min_severity: Severity | None = None,
    include_marine: bool | None = None,
    community_reports: Literal["off", "corroborated", "all"] | None = None,
):
    """Warning areas for the map (issue #21): the same alerts as GET /v1/alerts, as a
    GeoJSON FeatureCollection of their areas, simplified (~500 m) to keep it small.
    Alerts without an area (most earthquakes) aren't included; the map pins those."""
    prefs = AlertPreferences.from_dict({
        "hazard_types": hazard_types.split(",") if hazard_types else None,
        "min_severity": min_severity,
        "include_marine": include_marine,
        "community_reports": community_reports,
    })
    async with _pool().connection() as conn:
        rows = await alerts_near(conn, lat, lon, radius_km, prefs, min_tier=min_tier)
        ids = [r["event_id"] for r in rows]
        shapes = await (await conn.execute(
            """SELECT event_id, ST_AsGeoJSON(ST_SimplifyPreserveTopology(area::geometry, 0.005), 4)
               FROM events WHERE event_id = ANY(%s) AND area IS NOT NULL""", (ids,))).fetchall()
    by_id = {r["event_id"]: r for r in rows}
    features = []
    for event_id, geometry in shapes:
        r = by_id[event_id]
        features.append({
            "type": "Feature",
            "id": str(event_id),
            "geometry": json.loads(geometry),
            "properties": {"alert_id": str(event_id), "severity": r["severity"], "hazard_type": r["hazard_type"]},
        })
    return {"type": "FeatureCollection", "features": features}


# What to_alert needs from an event row.
EVENT_COLUMNS = """event_id, source, source_feed, external_id, hazard_type, product, marine, severity, tier,
    title, description, alert_headline, alert_body, distinct_reporter_count, reports_disagree,
    language, title_en, description_en, translation_status, translations, country,
    first_reported_at, last_updated_at, expires_at, raw_payload,
    ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon"""


@app.get("/v1/events/{event_id}")
@app.get("/v1/alerts/{event_id}")  # contract /alerts/{alert_id}: alert_id is the event_id
async def get_event(event_id: uuid.UUID,
                    lang: Annotated[str | None, Query(max_length=16, description="phone language, e.g. ja-JP")] = None):
    """One alert. With `lang`, an official alert is translated into the phone's language the
    first time anyone with that language opens it (moby/ai/alert_text.py), then cached."""
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {EVENT_COLUMNS} FROM events WHERE event_id = %s",
            (event_id,),
        )
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(404, "event not found")
        await alert_text.alert_in(conn, row, lang)
    return to_alert(row, lang)


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
            """SELECT r.report_id, r.hazard_type, r.observed_effect, r.severity, r.observed_at, r.captured_offline, r.source,
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
                "report_id": str(r["report_id"]),   # only so "This looks wrong" can name it
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


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    country: str | None = Field(None, pattern="^[A-Z]{2}$")
    language: str | None = Field(None, max_length=16, description="phone language, e.g. es-MX")


@app.post("/v1/ask")
async def ask_moby(body: AskRequest, caller: Annotated[Caller, Depends(require_user)]):
    """Ask Moby (moby/ai/ask.py): answers only from official alerts, Moby's guidance and
    official websites, with citations; `abstained` when it can't ground an answer.
    Signed-in only and rate-limited, since every question costs model calls."""
    if get_settings().token_factory_api_key is None:
        raise HTTPException(503, "Ask Moby isn't available right now")
    if not ask.allow(caller.uid):
        raise HTTPException(429, "Too many questions; try again later")
    async with _pool().connection() as conn:
        if not await budget.take(conn, "ask"):
            raise HTTPException(429, "Ask Moby has answered all it can for today; try again tomorrow")
    return await ask.answer(_pool(), body.question.strip(), lat=body.lat, lon=body.lon, country=body.country,
                            language=body.language)


class TripStop(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    name: str | None = Field(None, max_length=80, description="the place picked from the app's list")


class TripBriefRequest(BaseModel):
    lat: float | None = Field(None, ge=-90, le=90, description="a destination; or give stops for a route")
    lon: float | None = Field(None, ge=-180, le=180)
    stops: list[TripStop] | None = Field(None, min_length=2, max_length=trip.MAX_STOPS,
                                         description="a route, in order (straight lines between stops)")
    radius_km: float = Field(25, ge=1, le=100)
    start_date: date | None = Field(None, description="default: today (UTC)")
    end_date: date | None = Field(None, description="default: start_date + 3 days")
    country: str | None = Field(None, pattern="^[A-Z]{2}$")
    place_name: str | None = Field(None, max_length=80, description="the place picked from the app's list")

    @model_validator(mode="after")
    def _where_and_when(self):
        if self.stops is None and (self.lat is None or self.lon is None):
            raise ValueError("give lat and lon (a destination) or stops (a route)")
        if self.stops is not None and (self.lat is not None or self.lon is not None):
            raise ValueError("give either lat/lon or stops, not both")
        if self.stops and trip.route_length_km(self.stop_list()) > trip.MAX_ROUTE_KM:
            raise ValueError(f"route is longer than {trip.MAX_ROUTE_KM} km")
        today = datetime.now(timezone.utc).date()
        self.start_date = self.start_date or today
        self.end_date = self.end_date or self.start_date + timedelta(days=3)
        if not today - timedelta(days=1) <= self.start_date <= today + timedelta(days=365):
            raise ValueError("start_date must be between yesterday and a year from now")
        if not 0 <= (self.end_date - self.start_date).days <= 30:
            raise ValueError("end_date must be on or after start_date, at most 30 days later")
        return self

    def stop_list(self) -> list[trip.Stop] | None:
        return [trip.Stop(s.lat, s.lon, s.name) for s in self.stops] if self.stops else None


@app.post("/v1/trips/brief")
async def trip_brief(body: TripBriefRequest, caller: Annotated[Caller, Depends(require_user)]):
    """'Before you go' (moby/ai/trip.py): the active official alerts and recent community reports
    within radius_km of a destination or of a route through stops (PostGIS), why each matters for the trip (Nemotron Ultra,
    every statement cited and checked) and what the briefing can't tell you. Without the AI
    part (daily cap, no key) the same lists come back, labelled. Signed-in only, rate-limited;
    the destination isn't stored with the caller's identity."""
    if not trip.allow(caller.uid):
        raise HTTPException(429, "Too many briefings; try again later")
    assert body.start_date and body.end_date
    return await trip.brief(_pool(), lat=body.lat, lon=body.lon, stops=body.stop_list(), radius_km=body.radius_km,
                            start=body.start_date, end=body.end_date, country=body.country,
                            place_name=body.place_name)


@app.get("/v1/events/{event_id}/explain")
async def event_explain(event_id: uuid.UUID,
                        lang: Annotated[str | None, Query(max_length=16, description="phone language, e.g. es-MX")] = None):
    """'What this means for you' (moby/ai/explain.py): 200 with the explanation, 202 while
    Nemotron Super writes it (the first viewer asks; everyone after gets the cache), 404 when
    there is nothing to explain or it failed its grounding checks (the app then shows the
    official text only). Official warnings only: community reports have no agency text."""
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """UPDATE events SET explainer_status = 'pending'
               WHERE event_id = %s AND explainer_status = 'none' AND source = 'official'
                 AND length(coalesce(description, '')) >= 40""", (event_id,))
        await cur.execute(f"SELECT {EVENT_COLUMNS}, explainer, explainer_status FROM events WHERE event_id = %s",
                          (event_id,))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(404, "event not found")
        # Explained before Moby required an English translation (explain.untranslated): it's in
        # the agency's language, not the reader's, so it isn't served.
        if row["explainer_status"] == "done" and not explain.untranslated(row):
            explained = {k: row["explainer"].get(k) for k in ("summary", "actions", "model", "generated_at")}
            # In the phone's language when we can (moby/ai/localize.py); English otherwise.
            if (code := localize.normalize(lang)) and (loc := await localize.explanation_in(conn, row, code)):
                explained |= {"summary": loc["summary"], "actions": loc["actions"]}
                return {"event_id": str(event_id), **explained, "language": code}
            return {"event_id": str(event_id), **explained, "language": "en"}
    if row["explainer_status"] == "pending":
        return JSONResponse({"status": "pending", "retry_after_seconds": 5}, status_code=202)
    raise HTTPException(404, "no explanation for this alert")


@app.get("/v1/events/{event_id}/brief")
async def event_brief(event_id: uuid.UUID):
    """Contract 4. 200 with the brief, 202 while the situational_brief job is working on
    it. A brief that was never requested or failed is a 404: the app shows the alert
    on its own and never waits on this route.

    Opening an event also asks for a brief when community reports arrived that the current
    one doesn't cover (brief_queries.VIEW_SQL). With no brief yet that's a 202; with one,
    the reader gets it now and the rewrite follows (debounced, capped)."""
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        requested = (await cur.execute(BRIEF_ON_VIEW_SQL, {"event_id": event_id})).rowcount == 1
        await cur.execute(
            """SELECT e.brief_status, b.generated_at, b.model, b.summary, b.likely_progression, b.exposed_areas,
                      b.official_guidance, b.uncertainty, b.sources, b.version, b.claims, b.contradictions,
                      b.citations, b.changes, b.changes_since
               FROM events e LEFT JOIN briefs b USING (event_id) WHERE e.event_id = %s""",
            (event_id,),
        )
        row = await cur.fetchone()
        if row is not None and row["summary"] is not None:
            event = await (await cur.execute(TIMELINE_EVENT_SQL, {"event_id": event_id})).fetchone()
            groups = await (await cur.execute(TIMELINE_REPORTS_SQL, {"event_id": event_id})).fetchall()
            timeline = build_timeline(event, groups, attribution=SOURCE_ATTRIBUTION,
                                      generated_at=row["generated_at"])
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
            "version": row["version"],
            "claims": row["claims"],
            "contradictions": row["contradictions"],
            "citations": row["citations"],
            "changes": row["changes"],
            "changes_since": row["changes_since"].isoformat() if row["changes_since"] else None,
            "timeline": timeline,
        }
        return {k: v for k, v in brief.items() if v is not None}
    if row["brief_status"] == "pending" or requested:
        return JSONResponse({"status": "pending", "retry_after_seconds": 5}, status_code=202)
    raise HTTPException(404, "no brief for this event")


LEGAL_DIR = Path(__file__).resolve().parents[2] / "legal"
LEGAL_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title}</title>
<style>body{{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2a2e}}
table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #ddd;padding:.4rem;vertical-align:top;text-align:left}}
@media (prefers-color-scheme:dark){{body{{background:#181d1f;color:#e9edeb}}td,th{{border-color:#2e3638}}a{{color:#7fa79e}}}}</style>
</head><body>{body}</body></html>"""


@app.get("/legal/{doc}", response_class=HTMLResponse, include_in_schema=False)
async def legal(doc: Literal["privacy", "terms", "delete-account"]):
    """Privacy policy, terms and account deletion, linked from the app and the store listing
    (Google Play requires a web page for deleting an account)."""
    import markdown

    text = (LEGAL_DIR / f"{doc}.md").read_text()
    body = markdown.markdown(text, extensions=["tables"])
    titles = {"privacy": "Moby privacy policy", "terms": "Moby terms of use", "delete-account": "Delete your Moby account"}
    return LEGAL_PAGE.format(title=titles[doc], body=body)


@app.get("/v1/config")
async def get_config():
    # Feature-flag discipline (plan v3 §1): everything past Week 4 ships off.
    s = get_settings()
    return {
        "min_supported_client": "0.1.0",
        "flags": {
            "situational_brief": True,
            "cascade_analysis": False,
            "offline_guidance_cards": True,   # Week 5: synced cards + built-in fallbacks
            "on_device_assistant": False,
            "ask_moby": s.token_factory_api_key is not None,   # POST /v1/ask
            "mesh_relay": False,
            "proximity_confirmation": False,
            "early_tier_opt_in": False,
            "trip_briefing": True,   # POST /v1/trips/brief (works without AI too: the plain list)
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


