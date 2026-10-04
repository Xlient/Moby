"""Tsunami and tropical-cyclone warning centres (issue #8).

  PTWC  Pacific Tsunami Warning Center — Pacific and Caribbean tsunami messages (Atom)
  NHC   National Hurricane Center — Atlantic and East Pacific storms (RSS, nhc:Cyclone)
  JTWC  Joint Typhoon Warning Center — West Pacific / Indian Ocean (RSS index of
        text warnings; one extra fetch per storm)

One event per tsunami event / storm: later bulletins update it (keyed on the event
code or storm id), so the chain logic isn't needed. Areas are approximate and say so:
tsunamis a radius around the source by threat level; storms the convex hull of the
34-kt wind radii (or a default by intensity) over the current and forecast positions.
"""
import asyncio
import logging
import math
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import httpx
from psycopg_pool import AsyncConnectionPool

from .cap import XML_ACCEPT
from .geo import region_for
from .schema import NormalizedEvent, NormalizeResult, Severity

log = logging.getLogger("moby.feeds.centers")

PTWC_URL = "https://www.tsunami.gov/events/xml/PHEBAtom.xml"
# Atlantic, East Pacific and Central Pacific (CPHC publishes through the same site).
NHC_URLS = [f"https://www.nhc.noaa.gov/index-{basin}.xml" for basin in ("at", "ep", "cp")]
JTWC_URL = "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss"
INTERVAL = timedelta(minutes=5)

NM_KM = 1.852


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ── Geometry ─────────────────────────────────────────────────────────

def circle(lat: float, lon: float, r_km: float, n: int = 24) -> list[tuple[float, float]]:
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        out.append((lat + r_km / 111.32 * math.cos(a),
                    lon + r_km / (111.32 * max(0.05, math.cos(math.radians(lat)))) * math.sin(a)))
    return out


def hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Convex hull (monotone chain) of (lat, lon) points, closed ring."""
    pts = sorted(set((round(lon, 5), round(lat, 5)) for lat, lon in points))
    if len(pts) < 3:
        return [(lat, lon) for lon, lat in pts]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    ring = lower[:-1] + upper[:-1]
    ring.append(ring[0])
    return [(lat, lon) for lon, lat in ring]


def wkt(ring: list[tuple[float, float]]) -> str:
    return "MULTIPOLYGON(((" + ", ".join(f"{lon:.4f} {lat:.4f}" for lat, lon in ring) + ")))"


def swath(track: list[tuple[float, float, float]]) -> str:
    """Area covered by circles of radius r_km at each (lat, lon, r_km) track point."""
    return wkt(hull([p for lat, lon, r in track for p in circle(lat, lon, r)]))


# ── Tropical cyclones ────────────────────────────────────────────────

def cyclone_severity(kt: float) -> Severity:
    if kt >= 96:      # category 3+ / major hurricane / typhoon of that strength
        return "critical"
    if kt >= 64:      # hurricane / typhoon
        return "high"
    if kt >= 34:      # tropical storm
        return "medium"
    return "low"      # depression


def default_radius_km(kt: float) -> float:
    """When no wind radii are given: rough tropical-storm-force extent by intensity."""
    return 300 if kt >= 96 else 250 if kt >= 64 else 150


def _ll(text: str) -> tuple[float, float] | None:
    m = re.search(r"(\d+(?:\.\d+)?)\s*([NS])\s+(\d+(?:\.\d+)?)\s*([EW])", text)
    if not m:
        return None
    lat = float(m.group(1)) * (1 if m.group(2) == "N" else -1)
    lon = float(m.group(3)) * (1 if m.group(4) == "E" else -1)
    return lat, lon


def jtwc_issued(text: str, now: datetime) -> datetime:
    """Issue time from the header DTG ('WTPN32 PGTW 041500' = day 04, 15:00Z)."""
    m = re.search(r"^\s*W\w+\s+\w+\s+(\d{2})(\d{2})(\d{2})", text, re.M)
    if not m:
        return now
    day, hour, minute = (int(g) for g in m.groups())
    month, year = now.month, now.year
    if day > now.day + 1:                    # issued last month (around the 1st)
        month, year = (12, year - 1) if month == 1 else (month - 1, year)
    try:
        return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    except ValueError:
        return now


def parse_jtwc_warning(text: str, issued: datetime) -> dict | None:
    """Storm name, current position/winds and forecast track from a JTWC warning."""
    subj = re.search(r"SUBJ/(.+?)\s*WARNING NR\s*(\d+)", text)
    if not subj:
        return None
    blocks = re.split(r"\n\s*---\s*\n", text)
    track: list[tuple[float, float, float]] = []
    current_kt = None
    for block in blocks:
        pos_line = re.search(r"\d{6}Z\s*---\s*(?:NEAR\s*)?([0-9.]+[NS]\s+[0-9.]+[EW])", block)
        wind = re.search(r"MAX SUSTAINED WINDS - (\d+) KT", block)
        if not pos_line or not wind:
            continue
        ll = _ll(pos_line.group(1))
        if ll is None:
            continue
        kt = float(wind.group(1))
        r34 = [float(x) for x in re.findall(r"(\d{3}) NM", block.split("RADIUS OF 034 KT WINDS")[-1])[:4]] \
            if "RADIUS OF 034 KT WINDS" in block else []
        radius = max(r34) * NM_KM if r34 else default_radius_km(kt)
        track.append((ll[0], ll[1], radius))
        if current_kt is None:
            current_kt = kt
        if len(track) >= 5:          # ~72 h of forecast is plenty for "should I travel there"
            break
    if not track or current_kt is None:
        return None
    name = " ".join(subj.group(1).split()).title()
    storm_id = re.search(r"\b(\d{2}[A-Z])\b", subj.group(1))
    return {"name": name, "id": storm_id.group(1) if storm_id else name, "warning": int(subj.group(2)),
            "kt": current_kt, "track": track, "issued": issued}


def normalize_jtwc(index_xml: str, warnings: dict[str, str], *, now: datetime | None = None) -> NormalizeResult:
    now = now or datetime.now(timezone.utc)
    result = NormalizeResult()
    for url in jtwc_warning_links(index_xml):
        text = warnings.get(url)
        if text is None:
            result.skipped["fetch_failed"] += 1
            continue
        storm = parse_jtwc_warning(text, jtwc_issued(text, now))
        if storm is None:
            result.skipped["unparsed"] += 1
            continue
        # JTWC also lists East/Central Pacific (E, C) and Atlantic (L) storms, which are
        # NHC/CPHC's responsibility: take those from NHC so a storm appears once.
        if storm["id"][-1:] in ("E", "C", "L"):
            result.skipped["nhc_basin"] += 1
            continue
        if storm["issued"] + timedelta(hours=9) <= now:
            result.skipped["expired"] += 1
            continue
        lat, lon, _ = storm["track"][0]
        sev = cyclone_severity(storm["kt"])
        result.events.append(NormalizedEvent(
            source_feed="jtwc",
            external_id=f"{now.year}-{storm['id']}",
            hazard_type="storm",
            product="Tropical cyclone warning",
            severity=sev,
            title=f"{storm['name']} — winds {int(storm['kt'])} kt",
            description=(f"Joint Typhoon Warning Center warning #{storm['warning']}. Maximum sustained winds "
                         f"{int(storm['kt'])} kt ({int(storm['kt'] * 1.852)} km/h). The area shown covers "
                         f"tropical-storm-force winds along the forecast track and is approximate."),
            first_reported_at=storm["issued"],
            last_updated_at=storm["issued"],
            expires_at=storm["issued"] + timedelta(hours=9),   # warnings every 6 h; lapse if they stop
            lat=lat, lon=lon,
            region=region_for(lat, lon) or "INTL",
            area_wkt=swath(storm["track"]),
            raw_payload={"properties": {"id": f"jtwc:{storm['id']}:{storm['warning']}", "source_url": url,
                                        "authority": "Joint Typhoon Warning Center", "storm": storm["name"],
                                        "wind_kt": storm["kt"]}},
        ))
    return result


def jtwc_warning_links(index_xml: str) -> list[str]:
    """Text warning URLs ('TC Warning Text') from the RSS item HTML."""
    return list(dict.fromkeys(re.findall(r"href='([^']+?web\.txt)'[^>]*>\s*TC Warning Text", index_xml)))


def normalize_nhc(rss: str, *, now: datetime | None = None) -> NormalizeResult:
    """NHC RSS: one <nhc:Cyclone> per active storm (center, type, name, wind, datetime)."""
    now = now or datetime.now(timezone.utc)
    result = NormalizeResult()
    root = ET.fromstring(rss)
    for cyc in (el for el in root.iter() if _local(el.tag) == "Cyclone"):
        f = {_local(c.tag): (c.text or "").strip() for c in cyc}
        try:
            lat, lon = (float(v) for v in f["center"].split(","))
        except (KeyError, ValueError):
            result.skipped["no_location"] += 1
            continue
        mph = re.search(r"(\d+)", f.get("wind", ""))
        kt = float(mph.group(1)) * 0.869 if mph else 0.0
        ident = f.get("atcf") or f.get("wallet") or f.get("name", "storm")
        name = f"{f.get('type', 'Storm').title()} {f.get('name', '').title()}".strip()
        result.events.append(NormalizedEvent(
            source_feed="nhc",
            external_id=ident,
            hazard_type="storm",
            product=f.get("type", "Tropical cyclone").title(),
            severity=cyclone_severity(kt),
            title=f"{name} — winds {f.get('wind', '?')}",
            description=(f.get("headline") or "") + (f" Movement: {f['movement']}." if f.get("movement") else "")
            + " The area shown is approximate; see the NHC advisory for watches and warnings.",
            first_reported_at=now,
            last_updated_at=now,
            expires_at=now + timedelta(hours=9),
            lat=lat, lon=lon,
            region=region_for(lat, lon) or "INTL",
            area_wkt=swath([(lat, lon, default_radius_km(kt))]),
            raw_payload={"properties": {"id": f"nhc:{ident}:{f.get('datetime', '')}",
                                        "authority": "National Hurricane Center", **f}},
        ))
    return result


# ── Tsunami ──────────────────────────────────────────────────────────

TSUNAMI: dict[str, tuple[Severity, float, timedelta]] = {
    # category: (severity, radius km around the source, how long it stays up)
    "warning": ("critical", 1000, timedelta(hours=24)),
    "threat": ("critical", 1000, timedelta(hours=24)),
    "advisory": ("high", 500, timedelta(hours=24)),
    "watch": ("medium", 300, timedelta(hours=12)),
    "information": ("low", 100, timedelta(hours=6)),
}


def normalize_ptwc(atom: str, *, now: datetime | None = None) -> NormalizeResult:
    now = now or datetime.now(timezone.utc)
    result = NormalizeResult()
    root = ET.fromstring(atom)
    for entry in (el for el in root.iter() if _local(el.tag) == "entry"):
        f: dict[str, str] = {}
        links: list[tuple[str, str]] = []
        for c in entry:
            name = _local(c.tag)
            if name == "link":
                links.append((c.get("title") or "", c.get("href") or ""))
            elif name == "summary":
                f["summary"] = " ".join(" ".join(c.itertext()).split())   # <br/> separates fields
            else:
                f[name] = (c.text or "").strip()
        try:
            lat, lon = float(f["lat"]), float(f["long"])
        except (KeyError, ValueError):
            result.skipped["no_location"] += 1
            continue
        cat_m = re.search(r"Category:\s*(\w+)", f.get("summary", ""))
        category = (cat_m.group(1) if cat_m else "Information").lower()
        updated = _ts(f.get("updated")) or now
        bulletin = next((h for t, h in links if t == "Bulletin"), None) or next((h for _, h in links), "")
        event_code = re.search(r"/events/\w+/\d{4}/\d{2}/\d{2}/(\w+)/", bulletin)
        key = event_code.group(1) if event_code else f.get("id", "")
        mag = re.search(r"Preliminary Magnitude:\s*([0-9.]+)", f.get("summary", ""))
        cancelled = bool(re.search(r"cancel|final", f.get("summary", "") + f.get("title", ""), re.I))
        severity, radius, ttl = TSUNAMI.get(category, TSUNAMI["information"])
        expires = updated + ttl
        if expires <= now and not cancelled:
            result.skipped["expired"] += 1
            continue
        region_text = f.get("title", "").title()
        result.events.append(NormalizedEvent(
            source_feed="ptwc",
            external_id=key,
            hazard_type="flood",                  # tsunamis map to flood, as in GDACS
            product=f"Tsunami {category}",
            severity=severity,
            title=f"Tsunami {category} — {region_text}" if region_text else f"Tsunami {category}",
            description=(f"Pacific Tsunami Warning Center: tsunami {category}"
                         + (f" after a magnitude {mag.group(1)} earthquake" if mag else "")
                         + f". The area shown is approximate (within {int(radius)} km of the source); "
                           "follow local authorities and the full bulletin."),
            first_reported_at=updated,
            last_updated_at=updated,
            expires_at=now if cancelled else expires,
            lat=lat, lon=lon,
            region=region_for(lat, lon) or "INTL",
            magnitude=float(mag.group(1)) if mag else None,
            area_wkt=swath([(lat, lon, radius)]),
            raw_payload={"properties": {"id": f"ptwc:{f.get('id', key)}", "category": category, "bulletin": bulletin,
                                        "authority": "Pacific Tsunami Warning Center", "areaDesc": region_text}},
        ))
    return result


# ── Polling ──────────────────────────────────────────────────────────

async def _poll(name: str, pool: AsyncConnectionPool, http: httpx.AsyncClient) -> NormalizeResult:
    if name == "ptwc":
        r = await http.get(PTWC_URL, headers=XML_ACCEPT)
        r.raise_for_status()
        return normalize_ptwc(r.text)
    if name == "nhc":
        result = NormalizeResult()
        for url in NHC_URLS:
            r = await http.get(url, headers=XML_ACCEPT)
            r.raise_for_status()
            part = normalize_nhc(r.text)
            result.events += part.events
            result.skipped.update(part.skipped)
        return result
    # jtwc
    r = await http.get(JTWC_URL, headers=XML_ACCEPT)
    r.raise_for_status()
    links = jtwc_warning_links(r.text)
    texts: dict[str, str] = {}
    for url in links:
        try:
            w = await http.get(url)
            if w.status_code == 200:
                texts[url] = w.text
        except httpx.HTTPError:
            pass
    return normalize_jtwc(r.text, texts)


async def poll_center(name: str, pool: AsyncConnectionPool, http: httpx.AsyncClient) -> NormalizeResult:
    from .poller import _record_failure, upsert_events, ChainedEvent

    try:
        result = await _poll(name, pool, http)
    except (httpx.HTTPError, ET.ParseError) as e:
        await _record_failure(pool, name, None, f"{type(e).__name__}: {e}")  # type: ignore[arg-type]
        raise
    async with pool.connection() as conn, conn.transaction():
        await upsert_events(conn, [ChainedEvent(e, [e.raw_payload["properties"]["id"]]) for e in result.events])
        await conn.execute(
            """UPDATE feed_watermarks SET last_polled_at = now(), last_success_at = now(), last_status = 200,
               consecutive_failures = 0, last_error = NULL, updated_at = now() WHERE feed = %s""", (name,))
    return result


async def run_centers(pool: AsyncConnectionPool, http: httpx.AsyncClient, *, once: bool,
                      names: tuple[str, ...] = ("ptwc", "nhc", "jtwc")) -> None:
    async def loop(name: str) -> None:
        while True:
            try:
                r = await poll_center(name, pool, http)
                log.info("%s: %d active, skipped=%s", name, len(r.events), dict(r.skipped))
            except Exception as e:  # noqa: BLE001 - one centre down never stops the others
                log.warning("%s: poll failed: %s", name, e)
            if once:
                return
            await asyncio.sleep(INTERVAL.total_seconds())

    await asyncio.gather(*(loop(n) for n in names))
