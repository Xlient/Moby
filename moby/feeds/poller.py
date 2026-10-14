"""Conditional polling of the official feeds into `events` (plan v3 §12, Week 1).

Per poll:
  1. Read the feed's watermark; send If-None-Match / If-Modified-Since when we have them.
  2. 304, or a 200 whose body hash matches the last one → nothing changed.
  3. Otherwise normalize, resolve NOAA zone locations, and upsert events — in the SAME
     transaction as the watermark update. A crash mid-poll therefore leaves the old
     watermark in place and the next poll redoes the work: no gaps, no double counting
     (upserts are idempotent on (source_feed, external_id)).

Run continuously:   uv run python -m moby.feeds
One pass, all feeds: uv run python -m moby.feeds --once
"""
import asyncio
import hashlib
import json
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx
from psycopg import AsyncConnection
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from moby.config import get_settings
from moby.escalation.official import official_verification

from . import bipad, dedupe, emsc, eonet, gdacs, noaa, usgs
from .geo import centroid
from .schema import FeedName, NormalizedEvent, NormalizeResult

log = logging.getLogger("moby.feeds")


@dataclass(frozen=True)
class FeedSpec:
    name: FeedName
    interval: timedelta
    normalize: Callable[[dict], NormalizeResult]
    url: Callable[[timedelta | None], str]  # time since last success → URL to fetch
    snapshot: bool = False  # response is the complete active set (missing ⇒ ended)


FEEDS: dict[FeedName, FeedSpec] = {
    "noaa": FeedSpec("noaa", timedelta(seconds=60), noaa.normalize, lambda _gap: noaa.URL, snapshot=True),
    "usgs": FeedSpec("usgs", timedelta(seconds=60), usgs.normalize, usgs.url_for_gap),
    "eonet": FeedSpec("eonet", timedelta(minutes=10), eonet.normalize, lambda _gap: eonet.URL),
    "gdacs": FeedSpec("gdacs", timedelta(minutes=15), gdacs.normalize, lambda _gap: gdacs.URL),
    "emsc": FeedSpec("emsc", timedelta(seconds=90), emsc.normalize, emsc.url_for_gap),
    "bipad": FeedSpec("bipad", timedelta(minutes=5), bipad.normalize, lambda _gap: bipad.URL),
}

QUAKE_FEEDS = {"usgs", "emsc", "jma"}


@dataclass
class Watermark:
    etag: str | None
    last_modified: str | None
    last_success_at: datetime | None
    content_hash: str | None
    consecutive_failures: int


@dataclass
class PollOutcome:
    feed: FeedName
    status: int | str
    changed: bool = False
    upserted: int = 0
    expired: int = 0
    skipped: dict | None = None
    unlocated: int = 0
    cancelled: int = 0


def conditional_headers(wm: Watermark, url: str, default_url: str) -> dict[str, str]:
    """Validators only apply to the URL they came from. USGS widens its window after
    downtime; a validator from the hour feed must not be sent to the day feed."""
    if url != default_url:
        return {}
    headers = {}
    if wm.etag:
        headers["If-None-Match"] = wm.etag
    if wm.last_modified:
        headers["If-Modified-Since"] = wm.last_modified
    return headers


async def _read_watermark(conn: AsyncConnection, feed: FeedName) -> Watermark:
    row = await (await conn.execute(
        "SELECT etag, last_modified, last_success_at, content_hash, consecutive_failures "
        "FROM feed_watermarks WHERE feed = %s",
        (feed,),
    )).fetchone()
    if row is None:
        raise RuntimeError(f"feed_watermarks has no row for {feed!r}; run scripts/migrate.py")
    return Watermark(*row)


async def _record_failure(pool: AsyncConnectionPool, feed: FeedName, status: int | None, error: str) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """UPDATE feed_watermarks
               SET last_polled_at = now(), last_status = %s, last_error = %s,
                   consecutive_failures = consecutive_failures + 1, updated_at = now()
               WHERE feed = %s""",
            (status, error[:500], feed),
        )


# ── NOAA zones ───────────────────────────────────────────────────────────────

async def resolve_zones(
    events: list[NormalizedEvent], conn: AsyncConnection, http: httpx.AsyncClient
) -> int:
    """Locate geometry-less NOAA alerts at the mean centroid of their zones.
    Zones are fetched once and cached in nws_zones. Returns how many stay unlocated."""
    pending = [e for e in events if not e.has_location and e.zone_urls]
    if not pending:
        return 0
    urls = {u for e in pending for u in e.zone_urls}
    rows = await (await conn.execute(
        "SELECT zone_url, ST_Y(centroid::geometry), ST_X(centroid::geometry) "
        "FROM nws_zones WHERE zone_url = ANY(%s)",
        (list(urls),),
    )).fetchall()
    cache: dict[str, tuple[float, float] | None] = {
        r[0]: (r[1], r[2]) if r[1] is not None else None for r in rows
    }

    missing = [u for u in urls if u not in cache]
    sem = asyncio.Semaphore(4)  # be polite to api.weather.gov
    # Fetch concurrently, write sequentially (one connection).
    bodies = await asyncio.gather(*(_fetch_zone(http, sem, u) for u in missing))
    for url, body in zip(missing, bodies, strict=True):
        if body is None:
            continue  # not cached: retried on the next poll
        point = centroid(body.get("geometry"))  # (lat, lon) or None
        cache[url] = point
        lat, lon = point if point else (None, None)
        await conn.execute(
            """INSERT INTO nws_zones (zone_id, zone_url, name, centroid)
               VALUES (%(id)s, %(url)s, %(name)s,
                       CASE WHEN %(lat)s::float8 IS NULL THEN NULL
                            ELSE ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography END)
               ON CONFLICT (zone_id) DO UPDATE
                   SET centroid = EXCLUDED.centroid, name = EXCLUDED.name, fetched_at = now()""",
            {"id": url.rstrip("/").rsplit("/", 1)[-1], "url": url,
             "name": (body.get("properties") or {}).get("name"), "lat": lat, "lon": lon},
        )

    unlocated = 0
    for e in pending:
        points = [p for u in e.zone_urls if (p := cache.get(u))]
        if points:
            e.lat = sum(p[0] for p in points) / len(points)
            e.lon = sum(p[1] for p in points) / len(points)
        else:
            unlocated += 1
    return unlocated


async def _fetch_zone(http: httpx.AsyncClient, sem: asyncio.Semaphore, url: str) -> dict | None:
    async with sem:
        try:
            resp = await http.get(url, headers={"Accept": "application/geo+json"})
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("zone %s: %s %s", url, type(e).__name__, e)
            return None


# ── Alert chains (NOAA updates / cancellations) ──────────────────────────────

@dataclass
class ChainedEvent:
    """One row to upsert: the newest message of a chain plus every chain id seen."""
    event: NormalizedEvent
    item_ids: list[str]


def group_chains(events: list[NormalizedEvent], known: dict[str, str]) -> tuple[list[ChainedEvent], list[NormalizedEvent]]:
    """Fold messages into chains keyed by the chain's first identifier.

    `known` maps every feed id already stored → its row's external_id (chain key).
    Messages are processed oldest first so an Update always finds the alert it
    references, even when both arrive in the same poll. Returns (rows to upsert,
    cancellations). Mutates each event's external_id to its chain key.
    """
    chain_of = dict(known)
    chains: dict[str, ChainedEvent] = {}
    cancels: list[NormalizedEvent] = []
    for e in sorted(events, key=lambda ev: ev.first_reported_at):
        item_id = e.external_id
        key = chain_of.get(item_id) or next((chain_of[r] for r in e.references if r in chain_of), None) or item_id
        chain_of[item_id] = key
        e.external_id = key
        if e.cancels:
            cancels.append(e)
            continue
        if key in chains:
            chains[key].item_ids.append(item_id)
            chains[key].event = e  # newest message wins
        else:
            chains[key] = ChainedEvent(e, [item_id])
    return list(chains.values()), cancels


async def known_chain_ids(conn: AsyncConnection, feed: FeedName, events: list[NormalizedEvent]) -> dict[str, str]:
    ids = list({i for e in events for i in (e.external_id, *e.references)})
    rows = await (await conn.execute(
        "SELECT external_id, feed_item_ids FROM events WHERE source_feed = %s AND feed_item_ids && %s",
        (feed, ids),
    )).fetchall()
    return {item: ext for ext, items in rows for item in items}


async def apply_cancels(conn: AsyncConnection, feed: FeedName, cancels: list[NormalizedEvent]) -> int:
    """A Cancel ends the alert it references now (and joins its chain)."""
    n = 0
    for c in cancels:
        cur = await conn.execute(
            """UPDATE events
               SET expires_at = LEAST(COALESCE(expires_at, now()), now()),
                   last_updated_at = GREATEST(last_updated_at, %(sent)s),
                   feed_item_ids = CASE WHEN %(item)s = ANY(feed_item_ids) THEN feed_item_ids
                                        ELSE feed_item_ids || %(item)s END
               WHERE source_feed = %(feed)s AND external_id = %(key)s""",
            {"sent": c.first_reported_at, "item": c.raw_payload["properties"]["id"], "feed": feed, "key": c.external_id},
        )
        n += cur.rowcount
    return n


# ── Upsert ───────────────────────────────────────────────────────────────────

# Content columns only move forward in time: an older message in the chain never
# overwrites a newer one. Tier/confidence only ever rise from the feed policy and
# are left alone once a reviewer has decided; brief_status and the rest belong to
# the graph and are never touched here.
UPSERT_SQL = """
INSERT INTO events (
    source, source_feed, external_id, feed_item_ids, region, country, magnitude, language, translation_status,
    hazard_type, product, marine,
    severity, title, description, location, area, location_accuracy_m,
    first_reported_at, last_updated_at, expires_at, raw_payload, tier, confidence
) VALUES (
    'official', %(source_feed)s, %(external_id)s, %(item_ids)s, %(region)s, %(country)s, %(magnitude)s,
    %(language)s, %(translation_status)s, %(hazard_type)s,
    %(product)s, %(marine)s, %(severity)s, %(title)s, %(description)s,
    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
    -- Repair self-intersecting source polygons rather than reject the alert.
    CASE WHEN %(area)s::text IS NULL THEN NULL
         ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText(%(area)s::text, 4326)), 3))::geography END,
    %(accuracy)s,
    %(first_reported_at)s, %(last_updated_at)s, %(expires_at)s, %(raw_payload)s,
    %(tier)s, %(confidence)s
)
ON CONFLICT (source_feed, external_id) DO UPDATE SET
    -- append new chain ids, keeping arrival order (oldest first)
    feed_item_ids   = events.feed_item_ids || ARRAY(SELECT x FROM unnest(EXCLUDED.feed_item_ids) AS x
                                            WHERE NOT x = ANY(events.feed_item_ids)),
    hazard_type     = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.hazard_type ELSE events.hazard_type END,
    product         = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.product ELSE events.product END,
    marine          = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.marine ELSE events.marine END,
    severity        = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.severity ELSE events.severity END,
    title           = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.title ELSE events.title END,
    description     = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.description ELSE events.description END,
    location        = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.location ELSE events.location END,
    area            = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.area ELSE events.area END,
    country         = COALESCE(EXCLUDED.country, events.country),
    magnitude       = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.magnitude ELSE events.magnitude END,
    language        = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.language ELSE events.language END,
    -- New wording needs a new translation; unchanged wording keeps the one we have.
    translation_status = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at
                               AND (EXCLUDED.title IS DISTINCT FROM events.title
                                    OR EXCLUDED.description IS DISTINCT FROM events.description)
                              THEN EXCLUDED.translation_status ELSE events.translation_status END,
    raw_payload     = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.raw_payload ELSE events.raw_payload END,
    -- Always take the feed's current expiry: restores an alert a partial snapshot
    -- wrongly expired (see reconcile), and applies extensions/shortenings.
    expires_at      = CASE WHEN EXCLUDED.last_updated_at >= events.last_updated_at THEN EXCLUDED.expires_at ELSE events.expires_at END,
    last_updated_at = GREATEST(events.last_updated_at, EXCLUDED.last_updated_at),
    tier            = CASE WHEN events.reviewer_decision IS NULL THEN GREATEST(events.tier, EXCLUDED.tier) ELSE events.tier END,
    confidence      = CASE WHEN events.reviewer_decision IS NULL THEN GREATEST(events.confidence, EXCLUDED.confidence) ELSE events.confidence END
-- Skip no-op writes.
WHERE events.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
   OR events.expires_at IS DISTINCT FROM EXCLUDED.expires_at
   OR NOT (EXCLUDED.feed_item_ids <@ events.feed_item_ids)
   OR events.tier < EXCLUDED.tier
"""


def _params(row: ChainedEvent) -> dict:
    e = row.event
    v = official_verification(e)
    return {
        "source_feed": e.source_feed,
        "external_id": e.external_id,
        "item_ids": row.item_ids,
        "region": e.region,
        "country": e.country,
        "magnitude": e.magnitude,
        "language": None if not e.language or e.language.lower().startswith("en") else e.language,
        "translation_status": "not_needed" if not e.language or e.language.lower().startswith("en") else "pending",
        "area": e.area_wkt,
        "hazard_type": e.hazard_type,
        "product": e.product,
        "marine": e.marine,
        "severity": e.severity,
        "title": e.title,
        "description": e.description,
        "lat": e.lat,
        "lon": e.lon,
        "accuracy": e.location_accuracy_m,
        "first_reported_at": e.first_reported_at,
        "last_updated_at": e.last_updated_at,
        "expires_at": e.expires_at,
        "raw_payload": Jsonb(e.raw_payload),
        "tier": v.tier,
        "confidence": v.confidence,
    }


async def upsert_events(conn: AsyncConnection, rows: list[ChainedEvent]) -> int:
    located = [r for r in rows if r.event.has_location]
    if not located:
        return 0
    async with conn.cursor() as cur:
        await cur.executemany(UPSERT_SQL, [_params(r) for r in located])
        return cur.rowcount if cur.rowcount >= 0 else len(located)


async def reconcile(conn: AsyncConnection, feed: FeedName, active_item_ids: list[str]) -> int:
    """For snapshot feeds: a chain none of whose messages is still listed has ended
    (expired, cancelled, or replaced) — mark it expired now."""
    cur = await conn.execute(
        """UPDATE events SET expires_at = now()
           WHERE source_feed = %s AND NOT (feed_item_ids && %s)
             AND (expires_at IS NULL OR expires_at > now())""",
        (feed, active_item_ids),
    )
    return cur.rowcount


# ── One poll ─────────────────────────────────────────────────────────────────

async def poll_feed(
    spec: FeedSpec, pool: AsyncConnectionPool, http: httpx.AsyncClient, *, force: bool = False
) -> PollOutcome:
    """force: ignore validators and the body hash, re-normalizing everything — use after
    changing a normalizer or the tier policy so existing rows pick up the change."""
    async with pool.connection() as conn:
        wm = await _read_watermark(conn, spec.name)
    gap = datetime.now(timezone.utc) - wm.last_success_at if wm.last_success_at else None
    url = spec.url(gap)
    headers = {} if force else conditional_headers(wm, url, spec.url(timedelta(0)))

    try:
        resp = await http.get(url, headers=headers)
    except httpx.HTTPError as e:
        await _record_failure(pool, spec.name, None, f"{type(e).__name__}: {e}")
        raise

    if resp.status_code == 304:
        async with pool.connection() as conn:
            await conn.execute(
                """UPDATE feed_watermarks SET last_polled_at = now(), last_success_at = now(),
                   last_status = 304, consecutive_failures = 0, last_error = NULL, updated_at = now()
                   WHERE feed = %s""",
                (spec.name,),
            )
        return PollOutcome(spec.name, 304)

    if resp.status_code != 200:
        await _record_failure(pool, spec.name, resp.status_code, resp.text[:300])
        raise RuntimeError(f"{spec.name}: HTTP {resp.status_code}")

    body = resp.content
    digest = hashlib.sha256(body).hexdigest()
    new_etag = resp.headers.get("ETag") if url == spec.url(timedelta(0)) else None
    new_lm = resp.headers.get("Last-Modified") if url == spec.url(timedelta(0)) else None

    if digest == wm.content_hash and not force:
        async with pool.connection() as conn:
            await conn.execute(
                """UPDATE feed_watermarks SET last_polled_at = now(), last_success_at = now(),
                   last_status = 200, etag = %s, last_modified = %s, consecutive_failures = 0,
                   last_error = NULL, updated_at = now() WHERE feed = %s""",
                (new_etag, new_lm, spec.name),
            )
        return PollOutcome(spec.name, "200-unchanged")

    try:
        result = spec.normalize(json.loads(body))
    except (ValueError, KeyError, TypeError) as e:
        await _record_failure(pool, spec.name, 200, f"normalize failed: {type(e).__name__}: {e}")
        raise

    outcome = PollOutcome(spec.name, 200, changed=True, skipped=dict(result.skipped))
    async with pool.connection() as conn:
        outcome.unlocated = await resolve_zones(result.events, conn, http)
        async with conn.transaction():
            active_item_ids = [e.external_id for e in result.events if not e.cancels]
            known = await known_chain_ids(conn, spec.name, result.events)
            rows, cancels = group_chains(result.events, known)
            outcome.upserted = await upsert_events(conn, rows)
            outcome.cancelled = await apply_cancels(conn, spec.name, cancels)
            if spec.snapshot:
                outcome.expired = await reconcile(conn, spec.name, active_item_ids)
            if spec.name in QUAKE_FEEDS:
                await dedupe.merge_duplicate_quakes(conn)
            await conn.execute(
                """UPDATE feed_watermarks SET etag = %s, last_modified = %s, content_hash = %s,
                   last_polled_at = now(), last_success_at = now(), last_status = 200,
                   consecutive_failures = 0, last_error = NULL, updated_at = now()
                   WHERE feed = %s""",
                (new_etag, new_lm, digest, spec.name),
            )
    return outcome


# ── Scheduling ───────────────────────────────────────────────────────────────

def _http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers={"User-Agent": get_settings().nws_user_agent, "Accept": "application/geo+json, application/json"},
        follow_redirects=True,
    )


def _log_outcome(o: PollOutcome) -> None:
    if o.changed:
        log.info("%s: %s upserted=%d expired=%d cancelled=%d unlocated=%d skipped=%s",
                 o.feed, o.status, o.upserted, o.expired, o.cancelled, o.unlocated, o.skipped)
    else:
        log.info("%s: %s (no change)", o.feed, o.status)


async def run_feed(spec: FeedSpec, pool: AsyncConnectionPool, http: httpx.AsyncClient) -> None:
    failures = 0
    while True:
        try:
            _log_outcome(await poll_feed(spec, pool, http))
            failures = 0
            delay = spec.interval.total_seconds()
        except Exception as e:  # noqa: BLE001 - a feed outage must not stop the other feeds
            failures += 1
            log.warning("%s: poll failed (%d in a row): %s", spec.name, failures, e)
            # Back off, but never longer than 5 intervals: official feeds are the
            # primary signal and gaps are what this layer exists to prevent.
            delay = min(spec.interval.total_seconds() * 5, 15 * 2 ** failures)
        await asyncio.sleep(delay * random.uniform(0.9, 1.1))


async def run(feeds: list[FeedName], once: bool, force: bool = False) -> list[PollOutcome]:
    """feeds may include "cap" (national CAP sources, feeds/cap.py) and "centers" (PTWC,
    NHC, JTWC, feeds/centers.py): multi-document sources with their own poll loops."""
    from moby.db import make_pool

    from . import cap, centers, translate

    async with make_pool() as pool, _http_client() as http:
        specs = [FEEDS[f] for f in feeds if f in FEEDS]
        extra = []
        if "cap" in feeds:
            extra.append(cap.run_sources(pool, http, once=once))
        if "centers" in feeds:
            extra.append(centers.run_centers(pool, http, once=once))
        if "translate" in feeds:
            extra.append(translate.run_translator(pool, once=once))
        if extra:
            if once:
                await asyncio.gather(*extra)
            else:
                await asyncio.gather(*extra, *(run_feed(s, pool, http) for s in specs))
                return []
        if once:
            outcomes = await asyncio.gather(*(poll_feed(s, pool, http, force=force) for s in specs), return_exceptions=True)
            for s, o in zip(specs, outcomes, strict=True):
                if isinstance(o, Exception):
                    log.error("%s: %s", s.name, o)
                else:
                    _log_outcome(o)
            return [o for o in outcomes if isinstance(o, PollOutcome)]
        await asyncio.gather(*(run_feed(s, pool, http) for s in specs))
        return []


# ── Health ───────────────────────────────────────────────────────────────────

def stale_after(spec: FeedSpec) -> timedelta:
    """A feed is unhealthy once it has gone 3 cadences (min 5 min) without a good poll."""
    return max(spec.interval * 3, timedelta(minutes=5))


async def health(feeds: list[FeedName]) -> tuple[bool, list[str]]:
    """(healthy, report lines). Used by the container healthcheck."""
    from moby.db import make_pool

    now = datetime.now(timezone.utc)
    lines, ok = [], True
    async with make_pool(max_size=1) as pool, pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT feed, last_success_at, consecutive_failures, last_error FROM feed_watermarks"
        )).fetchall()
    by_feed = {r[0]: r[1:] for r in rows}
    if "centers" in feeds:
        for name in ("ptwc", "nhc", "jtwc", "jma"):
            last_ok, failures, error = by_feed.get(name, (None, 0, None))
            fresh = last_ok is not None and now - last_ok <= timedelta(minutes=30)
            lines.append(f"{'ok ' if fresh else 'warn'} {name:<6} last success "
                         f"{f'{int((now - last_ok).total_seconds())}s ago' if last_ok else 'never'}")
    if "cap" in feeds:
        # Reported, but not part of `ok`: an overseas service being down mustn't take
        # the container (and the US feeds with it) out of rotation.
        cap_rows = [(k, v) for k, v in by_feed.items() if k.startswith("cap:")]
        stale = [k for k, (last_ok, *_rest) in cap_rows
                 if last_ok is None or now - last_ok > timedelta(minutes=30)]
        lines.append(f"{'ok ' if not stale else 'warn'} cap    {len(cap_rows) - len(stale)}/{len(cap_rows)} sources fresh"
                     + (f" (stale: {', '.join(s[4:] for s in stale)})" if stale else ""))
    for name in (f for f in feeds if f in FEEDS):
        last_ok, failures, error = by_feed.get(name, (None, 0, None))
        age = now - last_ok if last_ok else None
        fresh = age is not None and age <= stale_after(FEEDS[name])
        ok &= fresh
        age_txt = f"{int(age.total_seconds())}s ago" if age is not None else "never"
        lines.append(f"{'ok ' if fresh else 'BAD'} {name:<6} last success {age_txt}, "
                     f"{failures} failures in a row{f' ({error[:80]})' if error and not fresh else ''}")
    return ok, lines
