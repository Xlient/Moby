"""Official warnings from national services worldwide, via CAP 1.2.

Sources come from the WMO/IFRC Alert Hub registry
(https://alert-hub-sources.s3.amazonaws.com/json; docs/spikes/global-coverage.md).
Phase 1 polls a pilot set of countries chosen for tourism × hazard risk.

Each source publishes an index (RSS or Atom) linking to one CAP document per
message. Documents are immutable (an update is a new document with `references`),
so each URL is fetched once (cap_documents) and messages are folded into one event
per alert with the same chain logic as NOAA.

Areas: CAP polygons or circles when given; otherwise the message's geocodes are
resolved to boundaries from cap_geocodes (MeteoAlarm EMMA_IDs; issue #9). Codes we
have no boundary for (e.g. India's LGD district codes, so far) are skipped and counted.
  - Text is stored in the language the agency used. An English <info> block is
    preferred when the message has one; translation is phase 2.
"""
import asyncio
import logging
import math
import re
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from psycopg_pool import AsyncConnectionPool

from .schema import HazardType, NormalizedEvent, Severity

log = logging.getLogger("moby.feeds.cap")


@dataclass(frozen=True)
class CapSource:
    source_id: str     # registry sourceId, e.g. "ph-pagasa-en"
    country: str       # ISO 3166-1 alpha-2
    authority: str     # shown as the alert's source
    url: str           # CAP feed index (RSS/Atom)
    # Some services (Macao SMG) rewrite one fixed URL per warning type instead of
    # publishing a new document per message: re-read those every poll.
    mutable_docs: bool = False


# Pilot (docs/spikes/global-coverage.md). URLs from the registry, checked 2026-10-04.
SOURCES: list[CapSource] = [
    CapSource("ph-pagasa-en", "PH", "PAGASA (Philippines)", "https://publicalert.pagasa.dost.gov.ph/feeds/"),
    CapSource("id-bmkg-en", "ID", "BMKG (Indonesia)", "https://www.bmkg.go.id/alerts/nowcast/en"),
    CapSource("mx-smn-es", "MX", "SMN (Mexico)", "https://smn.conagua.gob.mx/tools/PHP/feedsmn/cap.php"),
    CapSource("es-aemet-es", "ES", "AEMET (Spain)",
              "https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_wah_RSS.xml"),
    CapSource("in-ndma-xx", "IN", "NDMA (India)", "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml"),
    CapSource("jm-jms-en", "JM", "Meteorological Service of Jamaica", "https://alert.metservice.gov.jm/capfeed.php"),
    CapSource("is-vedur-is", "IS", "Icelandic Met Office", "https://api.vedur.is/cap/v1/capbroker/active/feed/met"),
    CapSource("nz-metservice-en", "NZ", "MetService (New Zealand)", "https://alerts.metservice.com/cap/rss"),
    CapSource("nz-gns-en", "NZ", "GeoNet (New Zealand)",
              "https://api.geonet.org.nz/cap/1.2/GPA1.0/feed/atom1.0/quake"),
    CapSource("hk-hko-xx", "HK", "Hong Kong Observatory", "https://alerts.weather.gov.hk/V1/cap_atom.xml"),
    # MeteoAlarm (EUMETNET): areas by EMMA_ID, resolved from cap_geocodes.
    CapSource("it-meteoam-it", "IT", "Aeronautica Militare via MeteoAlarm",
              "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-italy"),
    CapSource("gr-hnms-el", "GR", "HNMS (Greece) via MeteoAlarm",
              "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-greece"),
    CapSource("pt-ipma-pt", "PT", "IPMA (Portugal) via MeteoAlarm",
              "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-portugal"),
    # Greater China (#20). CMA via the WMO Alert Hub mirror (reachable from outside China);
    # areas are county codes, resolved lazily (geocodes.ensure_cn_boundaries).
    CapSource("cn-cma-xx", "CN", "China Meteorological Administration",
              "https://alert-feed-worldweather-org.s3.amazonaws.com/cn-cma-xx/rss.xml"),
    CapSource("mo-smg-xx", "MO", "Macao Meteorological and Geophysical Bureau",
              "https://rss.smg.gov.mo/cap_rss.xml", mutable_docs=True),
    CapSource("tw-ncdr-zh", "TW", "NCDR (Taiwan)", "https://alerts.ncdr.nat.gov.tw/RssAtomFeed.ashx"),
]

INTERVAL = timedelta(minutes=5)
# The shared client asks for JSON (US feeds); CAP sources serve XML and some (MeteoAlarm)
# answer 406 to a JSON-only Accept header.
XML_ACCEPT = {"Accept": "application/atom+xml, application/rss+xml, application/cap+xml, application/xml, text/xml, */*;q=0.5"}
MAX_NEW_DOCS_PER_POLL = 80     # a big backlog drains over a few polls instead of one burst
FETCH_CONCURRENCY = 4

# ── XML helpers ──────────────────────────────────────────────────────

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(el: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in el if _local(c.tag) == name]


def _text(el: ET.Element | None, name: str) -> str | None:
    if el is None:
        return None
    for c in el:
        if _local(c.tag) == name:
            t = (c.text or "").strip()
            return t or None
    return None


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ── Feed index ───────────────────────────────────────────────────────

_IP_HOST = re.compile(r"^(https?://)\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/")


def _same_host(url: str, index_url: str | None) -> str:
    """Some feeds (PAGASA) link documents by bare IP, which fails TLS verification
    (the certificate names the host). The same path is served on the feed's own host."""
    if index_url and _IP_HOST.match(url):
        host = re.match(r"^https?://[^/]+/", index_url)
        if host:
            return _IP_HOST.sub(host.group(0), url, count=1)
    return url


def _entry_time(e: ET.Element) -> datetime | None:
    for name in ("updated", "published", "pubDate", "sent"):
        if (t := _text(e, name)):
            if (dt := _ts(t)):
                return dt
            try:  # RSS pubDate is RFC 822
                from email.utils import parsedate_to_datetime
                return parsedate_to_datetime(t)
            except (TypeError, ValueError):
                continue
    return None


def index_links(xml: bytes | str, index_url: str | None = None) -> list[str]:
    """CAP document URLs from an RSS or Atom index, newest first (by the entry's own
    date when it has one: feeds list in either order)."""
    root = ET.fromstring(xml)
    entries = [el for el in root.iter() if _local(el.tag) in ("item", "entry")]
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    entries.sort(key=lambda e: _entry_time(e) or epoch, reverse=True)
    out: list[str] = []
    for e in entries:
        candidates: list[str] = []
        for c in e:
            if _local(c.tag) != "link":
                continue
            href = c.get("href") or (c.text or "").strip()
            if href:
                # Atom: prefer an explicit CAP type, then any link.
                kind = (c.get("type") or "").lower()
                candidates.insert(0, href) if "cap" in kind or "xml" in kind else candidates.append(href)
        # Prefer links that look like documents over site home pages.
        doc = next((u for u in candidates if re.search(r"(\.xml|\.cap|cap|identifier=|/alert)", u, re.I)), None)
        if doc or candidates:
            url = _same_host((doc or candidates[0]).replace("&amp;", "&"), index_url)
            if url not in out:
                out.append(url)
    return out


# ── CAP → NormalizedEvent ────────────────────────────────────────────

SEVERITY: dict[str, Severity] = {"Extreme": "critical", "Severe": "high", "Moderate": "medium", "Minor": "low"}

# Keyword → hazard, checked in order against the event name + headline (lowercased).
# Covers the pilot languages: English, Spanish, Indonesian, Icelandic.
HAZARD_WORDS: list[tuple[HazardType, tuple[str, ...]]] = [
    ("earthquake", ("earthquake", "quake", "sismo", "terremoto", "gempa", "jarðskj")),
    ("landslide", ("landslide", "mudslide", "debris flow", "deslizamiento", "deslave", "longsor", "aurskri")),
    ("flood", ("flood", "tsunami", "storm surge", "inundaci", "crecida", "lluvia", "rain", "banjir", "hujan",
               "flóð", "rigning")),
    ("fire", ("fire", "incendio", "kebakaran", "bushfire", "eld")),
    ("storm", ("storm", "thunder", "lightning", "wind", "gale", "typhoon", "cyclone", "hurricane", "tornado",
               "tormenta", "viento", "ciclón", "huracán", "tifón", "badai", "petir", "angin", "hail", "granizo",
               "snow", "nieve", "blizzard", "vind", "stormur", "wave", "oleaje")),
]
MARINE_WORDS = ("marine", "small craft", "large waves", "coastal", "sea ", "seas", "swell", "oleaje", "costero",
                "gelombang", "sjó", "maritim")


def classify(event: str, headline: str, category: str | None) -> HazardType:
    text = f"{event} {headline}".lower()
    for hazard, words in HAZARD_WORDS:
        if any(w in text for w in words):
            return hazard
    return {"Geo": "earthquake", "Fire": "fire"}.get(category or "", "other")


def _parse_points(text: str) -> list[tuple[float, float]]:
    """CAP polygon: space-separated 'lat,lon' pairs."""
    pts = []
    for pair in text.split():
        try:
            lat, lon = (float(v) for v in pair.split(",")[:2])
        except ValueError:
            continue
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            pts.append((lat, lon))
    return pts


def _circle(text: str, segments: int = 24) -> list[tuple[float, float]] | None:
    """CAP circle 'lat,lon radius_km' → polygon ring."""
    try:
        centre, radius = text.split()
        lat, lon = (float(v) for v in centre.split(","))
        r_km = float(radius)
    except ValueError:
        return None
    if r_km <= 0:
        return [(lat, lon)]
    ring = []
    for i in range(segments + 1):
        a = 2 * math.pi * i / segments
        dlat = r_km / 111.32 * math.cos(a)
        dlon = r_km / (111.32 * max(0.01, math.cos(math.radians(lat)))) * math.sin(a)
        ring.append((lat + dlat, lon + dlon))
    return ring


def areas_of(info: ET.Element) -> tuple[list[list[tuple[float, float]]], list[str], list[tuple[str, str]]]:
    """(polygon rings as (lat, lon), area descriptions, (scheme, code) geocodes)."""
    rings, names, codes = [], [], []
    for area in _children(info, "area"):
        if (desc := _text(area, "areaDesc")):
            names.append(desc)
        for c in area:
            name = _local(c.tag)
            if name == "geocode":
                scheme, value = _text(c, "valueName"), _text(c, "value")
                if scheme == "CPEAS Geographic Code" and value:
                    value = value[:6]       # county adcode: boundaries are per county
                if scheme and value and (scheme, value) not in codes:
                    codes.append((scheme, value))
            if name == "polygon" and c.text:
                ring = _parse_points(c.text)
                if len(ring) >= 3:
                    if ring[0] != ring[-1]:
                        ring.append(ring[0])
                    rings.append(ring)
            elif name == "circle" and c.text:
                ring = _circle(c.text.strip())
                if ring and len(ring) >= 4:
                    rings.append(ring)
    return rings, names, codes


def to_wkt(rings: list[list[tuple[float, float]]]) -> str:
    polys = ", ".join("((" + ", ".join(f"{lon:.5f} {lat:.5f}" for lat, lon in ring) + "))" for ring in rings)
    return f"MULTIPOLYGON({polys})"


def _pick_info(alert: ET.Element) -> ET.Element | None:
    infos = _children(alert, "info")
    if not infos:
        return None
    return next((i for i in infos if (_text(i, "language") or "").lower().startswith("en")), infos[0])


def normalize_cap(xml: bytes | str, source: CapSource, *, now: datetime | None = None) -> tuple[NormalizedEvent | None, str]:
    """(event, outcome). outcome is 'stored', 'cancel' or a skip reason."""
    now = now or datetime.now(timezone.utc)
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None, "not_xml"
    alert = root if _local(root.tag) == "alert" else next((e for e in root.iter() if _local(e.tag) == "alert"), None)
    if alert is None:
        return None, "not_cap"
    if _text(alert, "status") != "Actual":
        return None, "not_actual"          # Exercise / Test / Draft / System
    msg_type = _text(alert, "msgType") or "Alert"
    if msg_type not in ("Alert", "Update", "Cancel"):
        return None, "ack_or_error"
    identifier = _text(alert, "identifier")
    sent = _ts(_text(alert, "sent"))
    if not identifier or not sent:
        return None, "missing_identifier"

    item_id = f"{source.source_id}:{identifier}"
    references = []
    for ref in (_text(alert, "references") or "").split():
        parts = ref.split(",")
        if len(parts) >= 2:
            references.append(f"{source.source_id}:{parts[1]}")

    info = _pick_info(alert)
    if info is None:
        return None, "no_info"
    event_name = _text(info, "event") or ""
    headline = _text(info, "headline") or event_name
    expires = _ts(_text(info, "expires"))
    urgency = _text(info, "urgency")

    # A Cancel, or a final Update for something that's over ("urgency: Past"), ends the alert.
    ends = msg_type == "Cancel" or (urgency == "Past" and references)
    if not ends:
        if urgency == "Past":
            return None, "past"
        if expires and expires <= now:
            return None, "expired"

    rings, area_names, codes = areas_of(info)
    if not rings and not codes and not ends:
        return None, "no_area"
    points = [p for ring in rings for p in ring[:-1]] or [(0.0, 0.0)]
    lat = sum(p[0] for p in points) / len(points)
    lon = sum(p[1] for p in points) / len(points)

    description = "\n\n".join(t for t in (_text(info, "description"), _text(info, "instruction")) if t) or None
    langs = [(_text(i, "language") or "") for i in _children(alert, "info")]
    severity = SEVERITY.get(_text(info, "severity") or "", "low")
    text_l = f"{event_name} {headline}".lower()
    event = NormalizedEvent(
        source_feed="cap",
        external_id=item_id,
        hazard_type=classify(event_name, headline, _text(info, "category")),
        severity=severity,
        title=headline[:300] if headline else None,
        description=description[:4000] if description else None,
        first_reported_at=sent,
        last_updated_at=sent,
        raw_payload={
            # "properties.id" is what the shared chain/cancel code reads (see poller).
            "properties": {
                "id": item_id,
                "identifier": identifier,
                "sender": _text(alert, "sender"),
                "authority": source.authority,
                "source_id": source.source_id,
                "msgType": msg_type,
                "event": event_name,
                "headline": headline,
                "areaDesc": "; ".join(area_names),
                "severity": _text(info, "severity"),
                "urgency": urgency,
                "certainty": _text(info, "certainty"),
                "category": _text(info, "category"),
                "language": _text(info, "language"),
                "languages": langs,
                "web": _text(info, "web"),
            },
        },
        lat=lat if rings else None,
        lon=lon if rings else None,
        expires_at=expires,
        region="INTL",
        country=source.country,
        area_wkt=to_wkt(rings) if rings else None,
        geocodes=[] if rings else codes,
        language=_text(info, "language"),
        product=event_name[:120] or None,
        marine=any(w in f" {text_l} " for w in MARINE_WORDS),
        references=references,
        cancels=bool(ends),
    )
    return event, ("cancel" if ends else "stored")


# ── Polling ──────────────────────────────────────────────────────────

RESOLVE_SQL = """
SELECT ST_AsText(ST_Multi(ST_Union(area::geometry))),
       ST_Y(ST_PointOnSurface(ST_Union(area::geometry))), ST_X(ST_PointOnSurface(ST_Union(area::geometry))),
       string_agg(name, '; ' ORDER BY name)
FROM cap_geocodes WHERE (scheme, code) IN (SELECT * FROM unnest(%s::text[], %s::text[]))
"""


async def resolve_geocodes(conn, ev: NormalizedEvent) -> bool:
    """Give a geocode-only message its area from cap_geocodes. False if no code is known."""
    schemes = [s for s, _ in ev.geocodes]
    codes = [c for _, c in ev.geocodes]
    row = await (await conn.execute(RESOLVE_SQL, (schemes, codes))).fetchone()
    if not row or row[0] is None:
        return False
    ev.area_wkt, ev.lat, ev.lon = row[0], row[1], row[2]
    props = ev.raw_payload["properties"]
    if not props.get("areaDesc") and row[3]:
        props["areaDesc"] = row[3].title()
    props["geocodes"] = [f"{s}:{c}" for s, c in ev.geocodes]
    return True


def feed_name(source: CapSource) -> str:
    return f"cap:{source.source_id}"


@dataclass
class CapOutcome:
    source: str
    status: int | str
    new_docs: int = 0
    upserted: int = 0
    cancelled: int = 0
    skipped: Counter | None = None
    backlog: int = 0


async def _fetch(http: httpx.AsyncClient, sem: asyncio.Semaphore, url: str) -> tuple[str, bytes | None]:
    async with sem:
        try:
            r = await http.get(url, headers=XML_ACCEPT)
            return url, r.content if r.status_code == 200 else None
        except httpx.HTTPError:
            return url, None


async def poll_source(source: CapSource, pool: AsyncConnectionPool, http: httpx.AsyncClient) -> CapOutcome:
    from .poller import _read_watermark, _record_failure, apply_cancels, conditional_headers, group_chains, \
        known_chain_ids, upsert_events

    name = feed_name(source)
    async with pool.connection() as conn:
        await conn.execute("INSERT INTO feed_watermarks (feed) VALUES (%s) ON CONFLICT DO NOTHING", (name,))
        wm = await _read_watermark(conn, name)  # type: ignore[arg-type]

    try:
        resp = await http.get(source.url, headers={**XML_ACCEPT, **conditional_headers(wm, source.url, source.url)})
    except httpx.HTTPError as e:
        await _record_failure(pool, name, None, f"{type(e).__name__}: {e}")  # type: ignore[arg-type]
        raise
    if resp.status_code == 304:
        async with pool.connection() as conn:
            await conn.execute("""UPDATE feed_watermarks SET last_polled_at = now(), last_success_at = now(),
                                  last_status = 304, consecutive_failures = 0, last_error = NULL, updated_at = now()
                                  WHERE feed = %s""", (name,))
        return CapOutcome(source.source_id, 304)
    if resp.status_code != 200:
        await _record_failure(pool, name, resp.status_code, resp.text[:300])  # type: ignore[arg-type]
        raise RuntimeError(f"{name}: HTTP {resp.status_code}")
    try:
        links = index_links(resp.content, source.url)
    except ET.ParseError as e:
        await _record_failure(pool, name, 200, f"index not XML: {e}")  # type: ignore[arg-type]
        raise

    async with pool.connection() as conn:
        seen = {r[0] for r in await (await conn.execute(
            "SELECT url FROM cap_documents WHERE url = ANY(%s)", (links,))).fetchall()}
    unseen = links if source.mutable_docs else [u for u in links if u not in seen]
    new = unseen[:MAX_NEW_DOCS_PER_POLL]
    # More waiting than one poll takes: don't store validators, so the next poll reads
    # the index again instead of getting 304 and leaving the rest unread.
    backlog = len(unseen) > len(new)
    sem = asyncio.Semaphore(FETCH_CONCURRENCY)
    fetched = await asyncio.gather(*(_fetch(http, sem, u) for u in new))

    parsed: list[tuple[str, NormalizedEvent]] = []
    docs: list[tuple[str, str, str, str | None]] = []
    skipped: Counter = Counter()
    for url, body in fetched:
        if body is None:
            skipped["fetch_failed"] += 1      # not recorded: retried next poll
            continue
        ev, outcome = normalize_cap(body, source)
        if ev is not None:
            parsed.append((url, ev))
        else:
            skipped[outcome] += 1
            docs.append((url, source.source_id, "skipped", outcome))

    out = CapOutcome(source.source_id, 200, new_docs=len(new), skipped=skipped, backlog=len(unseen) - len(new))
    async with pool.connection() as conn, conn.transaction():
        cn_codes = [c for _, ev in parsed for s, c in ev.geocodes if s == "CPEAS Geographic Code"]
        cn_retry: set[str] = set()
        if cn_codes:
            from .geocodes import ensure_cn_boundaries
            cn_retry = await ensure_cn_boundaries(conn, http, cn_codes)
        events: list[NormalizedEvent] = []
        for url, ev in parsed:
            if ev.geocodes and not ev.cancels and not await resolve_geocodes(conn, ev):
                skipped["unknown_geocode"] += 1
                # Recorded so it isn't refetched every poll; loading boundaries clears
                # these records (geocodes.py), so they're retried once a scheme arrives.
                # A boundary that only failed to download is retried next poll instead.
                if not any(c in cn_retry for _, c in ev.geocodes):
                    docs.append((url, source.source_id, "skipped", "unknown_geocode"))
                continue
            events.append(ev)
            docs.append((url, source.source_id, "cancel" if ev.cancels else "stored", None))
        known = await known_chain_ids(conn, "cap", events)
        rows, cancels = group_chains(events, known)
        out.upserted = await upsert_events(conn, rows)
        out.cancelled = await apply_cancels(conn, "cap", cancels)
        async with conn.cursor() as cur:
            if not source.mutable_docs:          # rewritten in place: never "seen"
                await cur.executemany(
                    "INSERT INTO cap_documents (url, source_id, outcome, detail) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (url) DO NOTHING", docs)
        await conn.execute(
            """UPDATE feed_watermarks SET etag = %s, last_modified = %s, last_polled_at = now(),
               last_success_at = now(), last_status = 200, consecutive_failures = 0, last_error = NULL,
               updated_at = now() WHERE feed = %s""",
            (None if backlog else resp.headers.get("ETag"),
             None if backlog else resp.headers.get("Last-Modified"), name))
    return out


def log_outcome(o: CapOutcome) -> None:
    if o.status == 304 or not o.new_docs:
        log.info("cap:%s: %s (no new documents)", o.source, o.status)
    else:
        log.info("cap:%s: %d new documents, upserted=%d cancelled=%d skipped=%s%s",
                 o.source, o.new_docs, o.upserted, o.cancelled, dict(o.skipped or {}),
                 f" ({o.backlog} more next poll)" if o.backlog else "")


async def run_sources(pool: AsyncConnectionPool, http: httpx.AsyncClient, *, once: bool,
                      sources: list[CapSource] | None = None) -> None:
    """Poll every source each INTERVAL, staggered so they don't all fire at once.
    One source failing (timeouts are common abroad) never affects the others."""
    sources = sources or SOURCES

    async def loop(i: int, src: CapSource) -> None:
        if not once:
            await asyncio.sleep(i * INTERVAL.total_seconds() / max(1, len(sources)))
        while True:
            try:
                log_outcome(await poll_source(src, pool, http))
            except Exception as e:  # noqa: BLE001
                log.warning("cap:%s: poll failed: %s", src.source_id, e)
            if once:
                return
            await asyncio.sleep(INTERVAL.total_seconds())

    await asyncio.gather(*(loop(i, s) for i, s in enumerate(sources)))
