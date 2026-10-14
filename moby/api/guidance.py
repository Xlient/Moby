"""Offline guidance cards (plan v3 §8.1, migration 0008).

Public (the app syncs these while connected, then reads them with zero signal):
  GET  /v1/guidance/manifest?region=US      the live bundle: version + content_hash
  GET  /v1/guidance/cards?region=US         its cards (optionally one hazard_type)

Reviewers:
  GET  /v1/review/guidance                  draft bundles waiting for review
  GET  /v1/review/guidance/{bundle_id}      a bundle's cards, with their evidence quotes
  DELETE /v1/review/guidance/{bundle_id}/cards/{card_id}   drop a card from a draft
  POST /v1/review/guidance/{bundle_id}/publish   make it live (retires the previous one)

Internal (guidance job, Bearer MOBY_SERVICE_TOKEN):
  POST /internal/v1/guidance/bundles        store a new draft bundle

Cards are safety content synthesized by a model, so nothing reaches the app until a
person has read the draft and published it.
"""
import hashlib
import json
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from moby.feeds.schema import HazardType

from .auth import Caller, require_reviewer

router = APIRouter(tags=["guidance"])
Reviewer = Annotated[Caller, Depends(require_reviewer)]
Region = Literal["US", "CN"]

CARD_COLUMNS = """card_id, hazard_type, applies_when, title, body, priority, source_name, source_url,
                  last_reviewed_at, is_critical_fallback"""


def _pool():
    from .app import _pool as pool  # late import: app.py owns the pool and imports this module
    return pool()


def _service(authorization: Annotated[str | None, Header()] = None):
    from .app import require_service_token
    return require_service_token(authorization)


def card_out(r: dict) -> dict:
    """Contract `GuidanceCard` (evidence stays server-side)."""
    out = {
        "card_id": r["card_id"],
        "hazard_type": r["hazard_type"],
        "applies_when": r["applies_when"],
        "title": r["title"],
        "body": r["body"],
        "priority": r["priority"],
        "source_name": r["source_name"],
        "source_url": r["source_url"],
        "last_reviewed_at": r["last_reviewed_at"].isoformat()
        if isinstance(r["last_reviewed_at"], datetime) else r["last_reviewed_at"],
        "is_critical_fallback": r["is_critical_fallback"],
    }
    return {k: v for k, v in out.items() if v is not None}


def content_hash(cards: list[dict]) -> tuple[str, int]:
    """sha256 + size of the canonical cards JSON — what the app compares to decide re-download."""
    blob = json.dumps(sorted(cards, key=lambda c: c["card_id"]), sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(blob).hexdigest(), len(blob)


# ── Public ───────────────────────────────────────────────────────────

@router.get("/v1/guidance/manifest")
async def manifest(region: Region = "US"):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT b.bundle_id, b.region, b.version, b.content_hash, b.size_bytes, b.generated_at,
                      count(c.card_id) AS card_count, array_agg(DISTINCT c.hazard_type) AS hazard_types
               FROM guidance_bundles b JOIN guidance_cards c USING (bundle_id)
               WHERE b.region = %s AND b.status = 'published'
               GROUP BY b.bundle_id""",
            (region,),
        )
        rows = await cur.fetchall()
    return {"bundles": [{**r, "generated_at": r["generated_at"].isoformat(),
                         "hazard_types": sorted(r["hazard_types"])} for r in rows]}


@router.get("/v1/guidance/cards")
async def cards(region: Region, hazard_type: HazardType | None = None, bundle_version: str | None = None):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT bundle_id, version, content_hash FROM guidance_bundles WHERE region = %s AND status = 'published'",
            (region,),
        )
        bundle = await cur.fetchone()
        if bundle is None:
            return {"cards": []}
        if bundle_version and bundle_version != bundle["version"]:
            # The app asked for a version that's no longer live: it should re-read the manifest.
            raise HTTPException(409, f"bundle {bundle_version} is not current; current is {bundle['version']}")
        await cur.execute(
            f"""SELECT {CARD_COLUMNS} FROM guidance_cards
                WHERE bundle_id = %s AND (%s::text IS NULL OR hazard_type = %s)
                ORDER BY priority, card_id""",
            (bundle["bundle_id"], hazard_type, hazard_type),
        )
        rows = await cur.fetchall()
    return {"cards": [card_out(r) for r in rows], "version": bundle["version"],
            "content_hash": bundle["content_hash"]}


# ── Internal: the job stores a draft ─────────────────────────────────

class CardIn(BaseModel):
    card_id: str = Field(pattern=r"^[a-z0-9-]{3,64}$")
    hazard_type: HazardType
    applies_when: str | None = Field(default=None, max_length=120)
    title: str = Field(min_length=3, max_length=120)
    body: str = Field(min_length=20, max_length=1200)
    priority: int = Field(default=50, ge=0, le=100)
    source_name: str = Field(min_length=2, max_length=80)
    source_url: str = Field(pattern=r"^https://")
    last_reviewed_at: datetime
    is_critical_fallback: bool = False
    evidence: list[str] = Field(min_length=1, max_length=8)


class BundleIn(BaseModel):
    region: Region = "US"
    model: str
    cards: list[CardIn] = Field(min_length=1, max_length=200)


@router.post("/internal/v1/guidance/bundles", status_code=201, dependencies=[Depends(_service)])
async def store_bundle(body: BundleIn):
    if len({c.card_id for c in body.cards}) != len(body.cards):
        raise HTTPException(422, "duplicate card_id")
    public = [card_out(c.model_dump()) for c in body.cards]
    digest, size = content_hash(public)
    now = datetime.now(timezone.utc)
    async with _pool().connection() as conn, conn.transaction():
        (n,) = await (await conn.execute(
            "SELECT count(*) FROM guidance_bundles WHERE region = %s AND generated_at::date = %s::date",
            (body.region, now))).fetchone()
        version = f"{now:%Y.%m.%d}.{n + 1}"
        bundle_id = f"{body.region.lower()}-{version}"
        await conn.execute(
            """INSERT INTO guidance_bundles (bundle_id, region, version, content_hash, size_bytes, generated_at, model)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (bundle_id, body.region, version, digest, size, now, body.model),
        )
        async with conn.cursor() as cur:
            await cur.executemany(
                """INSERT INTO guidance_cards (card_id, bundle_id, hazard_type, applies_when, title, body, priority,
                                               source_name, source_url, last_reviewed_at, is_critical_fallback, evidence)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                [(c.card_id, bundle_id, c.hazard_type, c.applies_when, c.title, c.body, c.priority, c.source_name,
                  c.source_url, c.last_reviewed_at, c.is_critical_fallback, Jsonb(c.evidence)) for c in body.cards],
            )
    return {"bundle_id": bundle_id, "version": version, "status": "draft", "card_count": len(body.cards)}


# ── Reviewers ────────────────────────────────────────────────────────

@router.get("/v1/review/guidance")
async def drafts(_: Reviewer):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT b.bundle_id, b.region, b.version, b.status, b.generated_at, b.model, count(c.card_id) AS card_count
               FROM guidance_bundles b LEFT JOIN guidance_cards c USING (bundle_id)
               WHERE b.status IN ('draft', 'published')
               GROUP BY b.bundle_id ORDER BY b.generated_at DESC LIMIT 20""")
        rows = await cur.fetchall()
    return [{**r, "generated_at": r["generated_at"].isoformat()} for r in rows]


@router.get("/v1/review/guidance/{bundle_id}")
async def bundle_detail(bundle_id: str, _: Reviewer):
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute("SELECT bundle_id, region, version, status, model FROM guidance_bundles WHERE bundle_id = %s",
                          (bundle_id,))
        bundle = await cur.fetchone()
        if bundle is None:
            raise HTTPException(404, "no such bundle")
        await cur.execute(f"SELECT {CARD_COLUMNS}, evidence FROM guidance_cards WHERE bundle_id = %s "
                          "ORDER BY hazard_type, priority, card_id", (bundle_id,))
        rows = await cur.fetchall()
    return {**bundle, "cards": [{**card_out(r), "evidence": r["evidence"]} for r in rows]}


@router.delete("/v1/review/guidance/{bundle_id}/cards/{card_id}", status_code=204)
async def drop_card(bundle_id: str, card_id: str, _: Reviewer):
    async with _pool().connection() as conn, conn.transaction():
        row = await (await conn.execute(
            "SELECT status FROM guidance_bundles WHERE bundle_id = %s FOR UPDATE", (bundle_id,))).fetchone()
        if row is None:
            raise HTTPException(404, "no such bundle")
        if row[0] != "draft":
            raise HTTPException(409, "only drafts can be edited")
        cur = await conn.execute("DELETE FROM guidance_cards WHERE bundle_id = %s AND card_id = %s",
                                 (bundle_id, card_id))
    if cur.rowcount == 0:
        raise HTTPException(404, "no such card")
    return Response(status_code=204)


@router.post("/v1/review/guidance/{bundle_id}/publish", status_code=204)
async def publish(bundle_id: str, reviewer: Reviewer):
    async with _pool().connection() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        await cur.execute("SELECT region, status FROM guidance_bundles WHERE bundle_id = %s FOR UPDATE", (bundle_id,))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(404, "no such bundle")
        if row["status"] != "draft":
            raise HTTPException(409, f"bundle is {row['status']}")
        await cur.execute(f"SELECT {CARD_COLUMNS} FROM guidance_cards WHERE bundle_id = %s", (bundle_id,))
        cards = [card_out(r) for r in await cur.fetchall()]
        if not cards:
            raise HTTPException(409, "bundle has no cards")
        # Cards may have been dropped since the draft was stored: hash what actually goes live.
        digest, size = content_hash(cards)
        await cur.execute("UPDATE guidance_bundles SET status = 'retired' WHERE region = %s AND status = 'published'",
                          (row["region"],))
        await cur.execute(
            "UPDATE guidance_bundles SET status = 'published', published_at = now(), published_by = %s, "
            "content_hash = %s, size_bytes = %s WHERE bundle_id = %s",
            (reviewer.reporter_hash, digest, size, bundle_id))
    return Response(status_code=204)
