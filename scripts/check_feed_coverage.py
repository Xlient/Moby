"""End-to-end coverage of the non-US official feeds: does what an agency publishes
right now reach GET /v1/alerts?

    uv run python scripts/check_feed_coverage.py               # markdown table
    uv run python scripts/check_feed_coverage.py --json out.json --source cn-cma-xx

Per source:
  1. Fetch the feed directly and run it through Moby's own normalizer, so "current"
     means exactly what the poller would store (not expired, not a test, not a cancel).
  2. Ask the live API for alerts (public, no sign-in) at representative points in the
     country and at the feed's own current items, and count the ones from that source.

Status:
  ok       current items in the feed, and alerts from the source in the API
  partial  some sampled feed items have no matching alert at their location
  quiet    the feed answered and has nothing current (and the API agrees)
  stale?   nothing current in the feed, but the API still shows alerts from it
  BROKEN   the feed failed, or it has current items and none reach the API

The API URL comes from --api, MOBY_API_URL, or EXPO_PUBLIC_API_URL in .env. It's never
printed (Actions logs and issues on this repository are public). Read-only: no database,
no paid models. Exits 0 unless --strict and something is BROKEN.
"""
import argparse
import asyncio
import json
import os
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Awaitable, Callable

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from moby.api.alerts import SOURCE_ATTRIBUTION  # noqa: E402
from moby.feeds import bipad, cap, centers, emsc, eonet, gdacs, jma  # noqa: E402
from moby.feeds.schema import NormalizedEvent, NormalizeResult  # noqa: E402

USER_AGENT = "moby-feed-coverage/0.1 (github.com/Xlient/Moby)"
MAX_DOCS = 60            # CAP documents read per source (newest first)
MAX_ITEM_PROBES = 8      # feed items looked up in the API at their own location, per source
GRACE = timedelta(minutes=15)   # newer than this may not have been polled yet (CAP: every 5 min)
COUNTRY_RADIUS_KM = 300
ITEM_RADIUS_KM = 15
QUAKE_RADIUS_KM = 50     # networks place a quake tens of km apart; dedupe merges within 50 km
OPEN_ENDED = timedelta(days=7)  # an alert with no expiry this old is worth a look
API_LIMIT = 200          # alerts_near's LIMIT: a full page means the count is a lower bound

# Representative points (lat, lon): big cities and where travellers go, spread so that
# COUNTRY_RADIUS_KM circles cover most of the populated country.
COUNTRY_POINTS: dict[str, list[tuple[float, float]]] = {
    "PH": [(14.60, 120.98), (10.32, 123.89), (7.07, 125.61), (16.41, 120.59)],
    "ID": [(-6.21, 106.85), (-7.25, 112.75), (-8.65, 115.22), (3.59, 98.67), (-5.15, 119.43), (-0.95, 100.35)],
    "MX": [(19.43, -99.13), (25.69, -100.32), (20.67, -103.35), (21.16, -86.85), (17.06, -96.72), (32.51, -117.04)],
    "ES": [(40.42, -3.70), (41.39, 2.17), (37.39, -5.98), (39.47, -0.38), (43.26, -2.93), (28.12, -15.43), (39.57, 2.65)],
    "IN": [(28.61, 77.21), (19.08, 72.88), (13.08, 80.27), (22.57, 88.36), (26.14, 91.74), (12.97, 77.59),
           (15.50, 73.83), (32.24, 77.19), (23.03, 72.58), (25.59, 85.14)],
    "JM": [(18.02, -76.80), (18.47, -77.92)],
    "IS": [(64.15, -21.94), (65.68, -18.09), (64.25, -15.21)],
    "NZ": [(-36.85, 174.76), (-41.29, 174.78), (-43.53, 172.64), (-45.03, 168.66), (-39.49, 176.91)],
    "HK": [(22.30, 114.17)],
    "IT": [(41.90, 12.50), (45.46, 9.19), (40.85, 14.27), (38.12, 13.36), (43.77, 11.26), (39.22, 9.12)],
    "GR": [(37.98, 23.73), (40.64, 22.94), (35.34, 25.13), (39.62, 19.92), (36.43, 28.22)],
    "PT": [(38.72, -9.14), (41.15, -8.61), (37.02, -7.93), (32.65, -16.91), (37.74, -25.67)],
    # Guizhou and Chongqing had CMA warnings on 2026-10-18; Sichuan (Chengdu) is the control.
    "CN": [(26.65, 106.63), (29.56, 106.55), (30.66, 104.07), (39.90, 116.40), (31.23, 121.47), (23.13, 113.26),
           (25.04, 102.71), (43.83, 87.62), (45.80, 126.53), (29.65, 91.13), (34.34, 108.94), (30.59, 114.31)],
    "MO": [(22.19, 113.54)],
    "TW": [(25.03, 121.57), (22.63, 120.30), (23.99, 121.60)],
    "JP": [(35.68, 139.69), (34.69, 135.50), (43.06, 141.35), (33.59, 130.40), (38.27, 140.87), (31.60, 130.56),
           (26.21, 127.68), (36.56, 138.20)],
    "NP": [(27.72, 85.32), (28.21, 83.99), (26.45, 87.27), (28.05, 81.62), (27.53, 84.35)],
}


@dataclass
class Item:
    id: str
    issued: datetime
    lat: float | None
    lon: float | None


@dataclass
class FeedResult:
    entries: int = 0                    # items in the feed, before normalizing
    read: int = 0                       # of those, how many were read (CAP: capped at MAX_DOCS)
    current: list[Item] = field(default_factory=list)
    skipped: Counter = field(default_factory=Counter)
    error: str | None = None


@dataclass
class Check:
    name: str
    country: str | None                 # None: worldwide (probe at the items only)
    authorities: set[str]               # source_attribution values that count as this source
    fetch: Callable[[httpx.AsyncClient], Awaitable[FeedResult]]
    # Also accept these when probing an item (quakes merged into another network's copy).
    also: set[str] = field(default_factory=set)
    probe_km: float = ITEM_RADIUS_KM
    grace: timedelta = GRACE            # NHC stamps a storm with the time it's read: no wait


@dataclass
class Row:
    source: str
    country: str
    feed: FeedResult
    api_alerts: int = 0
    api_capped: bool = False
    api_oldest: datetime | None = None
    api_newest: datetime | None = None
    probed: int = 0
    found: int = 0
    open_ended: int = 0                 # API alerts with no expiry, issued more than OPEN_ENDED ago
    grace: timedelta = GRACE
    api_error: str | None = None
    status: str = ""
    note: str = ""


# ── Feeds ────────────────────────────────────────────────────────────

def _items(result: NormalizeResult, *, exclude_us: bool = False) -> list[Item]:
    return [Item(e.external_id, e.first_reported_at, e.lat, e.lon) for e in result.events
            if not e.cancels and not (exclude_us and e.region == "US")]


def _on_area(ev: NormalizedEvent) -> tuple[float | None, float | None]:
    """A point on the alert's own area: the vertex mean (ev.lat/lon) of a coastal strip
    or a crescent can lie far outside it."""
    if ev.area_wkt:
        lon, lat = ev.area_wkt.split("(((", 1)[1].split(",", 1)[0].split()
        return float(lat), float(lon)
    return ev.lat, ev.lon


def _err(e: Exception) -> str:
    """Short error without the URL (some hosts we hit are private)."""
    if isinstance(e, httpx.HTTPStatusError):
        return f"HTTP {e.response.status_code}"
    return type(e).__name__


async def fetch_cap(src: cap.CapSource, http: httpx.AsyncClient, max_docs: int) -> FeedResult:
    out = FeedResult()
    r = await http.get(src.url, headers=cap.XML_ACCEPT)
    r.raise_for_status()
    links = cap.index_links(r.content, src.url)
    out.entries = len(links)
    sem = asyncio.Semaphore(cap.FETCH_CONCURRENCY)
    fetched = await asyncio.gather(*(cap._fetch(http, sem, u) for u in links[:max_docs]))
    out.read = len(fetched)
    now = datetime.now(timezone.utc)
    events: list[NormalizedEvent] = []
    for _url, body in fetched:
        if body is None:
            out.skipped["fetch_failed"] += 1
            continue
        ev, outcome = cap.normalize_cap(body, src, now=now)
        if ev is None or ev.cancels:
            out.skipped[outcome] += 1
            continue
        events.append(ev)
    # An Update replaces the message it references (one alert per chain, as the poller stores it).
    replaced = {r for ev in events for r in ev.references}
    for ev in events:
        if ev.external_id in replaced:
            out.skipped["updated_later"] += 1
            continue
        if ev.geocodes:
            out.skipped["geocode_only"] += 1          # counted as current, area resolved server-side
        out.current.append(Item(ev.external_id, ev.first_reported_at, *_on_area(ev)))
    return out


async def fetch_json(url: str, normalize: Callable[[dict], NormalizeResult], http: httpx.AsyncClient,
                     *, entries_key: str, exclude_us: bool = False) -> FeedResult:
    r = await http.get(url)
    r.raise_for_status()
    payload = r.json()
    res = normalize(payload)
    out = FeedResult(entries=len(payload.get(entries_key) or []), current=_items(res, exclude_us=exclude_us),
                     skipped=res.skipped)
    out.read = out.entries
    return out


async def fetch_jma(http: httpx.AsyncClient) -> FeedResult:
    vl = await http.get(jma.VOLCANO_LIST_URL)
    vl.raise_for_status()
    q = await http.get(jma.QUAKE_URL)
    q.raise_for_status()
    v = await http.get(jma.VOLCANO_URL)
    v.raise_for_status()
    quakes = jma.normalize_quakes(q.json())
    volcanoes = jma.normalize_volcanoes(v.json(), {x["code"]: x for x in vl.json()})
    out = FeedResult(entries=len(q.json()) + len(v.json()),
                     current=_items(quakes) + _items(volcanoes), skipped=quakes.skipped + volcanoes.skipped)
    out.read = out.entries
    return out


async def fetch_emsc(http: httpx.AsyncClient) -> FeedResult:
    # The API keeps a quake for as long as it's listed; look back a day, like USGS's day window.
    return await fetch_json(emsc.url_for_gap(timedelta(days=1)), emsc.normalize, http,
                            entries_key="features", exclude_us=True)


async def fetch_center(name: str, http: httpx.AsyncClient) -> FeedResult:
    res = await centers._poll(name, None, http)  # type: ignore[arg-type]  # pool unused by _poll
    out = FeedResult(entries=len(res.events) + sum(res.skipped.values()), current=_items(res),
                     skipped=res.skipped)
    out.read = out.entries
    return out


def checks(max_docs: int) -> list[Check]:
    out = [Check(s.source_id, s.country, {s.authority},
                 (lambda http, s=s: fetch_cap(s, http, max_docs))) for s in cap.SOURCES]
    quake_names = {SOURCE_ATTRIBUTION[f] for f in ("usgs", "emsc", "jma")}
    out += [
        Check("jma", "JP", {jma.AUTHORITY}, fetch_jma, also=quake_names, probe_km=QUAKE_RADIUS_KM),
        Check("bipad", "NP", {*bipad.AUTHORITY.values(), "BIPAD (Government of Nepal)"},
              lambda http: fetch_json(bipad.URL, bipad.normalize, http, entries_key="results")),
        Check("emsc", None, {SOURCE_ATTRIBUTION["emsc"]}, fetch_emsc, also=quake_names, probe_km=QUAKE_RADIUS_KM),
        # GDACS earthquakes are merged into the USGS/EMSC copy like any other network's.
        Check("gdacs", None, {SOURCE_ATTRIBUTION["gdacs"]},
              lambda http: fetch_json(gdacs.URL, gdacs.normalize, http, entries_key="features", exclude_us=True),
              also=quake_names, probe_km=QUAKE_RADIUS_KM),
        Check("eonet", None, {SOURCE_ATTRIBUTION["eonet"]},
              lambda http: fetch_json(eonet.URL, eonet.normalize, http, entries_key="events", exclude_us=True)),
    ]
    out += [Check(n, None, {SOURCE_ATTRIBUTION[n]}, (lambda http, n=n: fetch_center(n, http)),
                  grace=timedelta(0) if n == "nhc" else GRACE)
            for n in ("ptwc", "nhc", "jtwc")]
    return out


# ── API ──────────────────────────────────────────────────────────────

class Api:
    def __init__(self, base: str, http: httpx.AsyncClient, concurrency: int = 4):
        self.base, self.http = base, http
        self.sem = asyncio.Semaphore(concurrency)
        self.cache: dict[tuple, list[dict]] = {}

    async def alerts(self, lat: float, lon: float, radius_km: float) -> list[dict]:
        key = (round(lat, 3), round(lon, 3), radius_km)
        if key not in self.cache:
            # Everything an official source has here: no tier, severity, hazard or marine filter.
            params = {"lat": lat, "lon": lon, "radius_km": radius_km, "min_tier": 0, "community_reports": "off",
                      "min_severity": "low", "include_marine": "true"}
            async with self.sem:
                for attempt in range(3):
                    try:
                        r = await self.http.get(f"{self.base}/v1/alerts", params=params)
                        r.raise_for_status()
                        break
                    except httpx.HTTPError as e:
                        if attempt == 2:
                            raise RuntimeError(f"API: {_err(e)}") from None
                        await asyncio.sleep(2 * (attempt + 1))
            self.cache[key] = r.json().get("alerts", [])
        return self.cache[key]


def _probe_items(items: list[Item], now: datetime, limit: int, grace: timedelta = GRACE) -> list[Item]:
    """Located items old enough to have been polled, spread across the feed (newest first)."""
    located = sorted((i for i in items if i.lat is not None and i.issued <= now - grace),
                     key=lambda i: i.issued, reverse=True)
    if len(located) <= limit:
        return located
    step = len(located) / limit
    return [located[int(k * step)] for k in range(limit)]


async def check_api(c: Check, row: Row, api: Api, now: datetime) -> None:
    seen: dict[str, dict] = {}

    def take(alerts: list[dict], names: set[str]) -> bool:
        hit = False
        for a in alerts:
            if a.get("source_attribution") in names:
                hit = True
                if a.get("source_attribution") in c.authorities:
                    seen[a["alert_id"]] = a
        return hit

    points = COUNTRY_POINTS.get(c.country or "", [])
    for page in await asyncio.gather(*(api.alerts(lat, lon, COUNTRY_RADIUS_KM) for lat, lon in points)):
        take(page, c.authorities)
        row.api_capped |= len(page) >= API_LIMIT
    probes = _probe_items(row.feed.current, now, MAX_ITEM_PROBES, c.grace)
    pages = await asyncio.gather(*(api.alerts(i.lat, i.lon, c.probe_km) for i in probes))  # type: ignore[arg-type]
    row.probed = len(probes)
    row.found = sum(take(page, c.authorities | c.also) for page in pages)
    row.api_alerts = len(seen)
    issued = [datetime.fromisoformat(a["issued_at"]) for a in seen.values()]
    row.api_oldest, row.api_newest = (min(issued), max(issued)) if issued else (None, None)
    row.open_ended = sum(1 for a in seen.values()
                         if not a.get("expires_at") and datetime.fromisoformat(a["issued_at"]) < now - OPEN_ENDED)


def classify(row: Row) -> tuple[str, str]:
    """(status, note) — see the module docstring."""
    f = row.feed
    if f.error:
        return "BROKEN", f"feed: {f.error}"
    if row.api_error:
        return "?", row.api_error
    current = len(f.current)
    if current == 0:
        if row.api_alerts:
            return "stale?", "API shows alerts the feed no longer has as current (expiry?)"
        return "quiet", "feed answered, nothing current" if f.entries else "feed answered, empty"
    if row.api_alerts == 0 and row.found == 0:
        polled = [i for i in f.current if i.issued <= datetime.now(timezone.utc) - row.grace]
        if not polled:
            return "quiet", "only items newer than the poll interval"
        return "BROKEN", "feed has current items, none reach the API"
    if row.probed and row.found < row.probed:
        return "partial", f"{row.probed - row.found} of {row.probed} sampled items not found at their location"
    return "ok", ""


async def run(selected: set[str] | None, base: str, max_docs: int) -> list[Row]:
    rows: list[Row] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True,
                                 headers={"User-Agent": USER_AGENT, "Accept": "application/json"}) as http:
        api = Api(base, http)

        async def one(c: Check) -> Row:
            try:
                feed = await c.fetch(http)
            except Exception as e:  # noqa: BLE001 - every failure is a row in the table
                feed = FeedResult(error=_err(e))
            row = Row(c.name, c.country or "world", feed, grace=c.grace)
            try:
                await check_api(c, row, api, datetime.now(timezone.utc))
            except RuntimeError as e:
                row.api_error = str(e)
            row.status, row.note = classify(row)
            return row

        rows = await asyncio.gather(*(one(c) for c in checks(max_docs) if not selected or c.name in selected))
    return list(rows)


# ── Output ───────────────────────────────────────────────────────────

def _ago(dt: datetime | None, now: datetime) -> str:
    if dt is None:
        return "–"
    s = (now - dt).total_seconds()
    if s < 0:
        return "future"
    return f"{s / 60:.0f}m" if s < 3600 else f"{s / 3600:.0f}h" if s < 172800 else f"{s / 86400:.0f}d"


def markdown(rows: list[Row], now: datetime) -> str:
    lines = [f"Feed coverage, {now:%Y-%m-%d %H:%M} UTC. Ages are time since issued.", "",
             "| Source | Country | Feed entries | Current (read) | API alerts | Items found | Feed oldest | "
             "Feed newest | API oldest | API newest | Status | Notes |",
             "|---|---|---:|---:|---:|---:|---|---|---|---|---|---|"]
    for r in sorted(rows, key=lambda r: (["BROKEN", "?", "partial", "stale?", "ok", "quiet"].index(r.status),
                                         r.source)):
        f = r.feed
        issued = [i.issued for i in f.current]
        skipped = ", ".join(f"{k} {v}" for k, v in f.skipped.most_common(4))
        open_ended = f"{r.open_ended} with no expiry, issued >{OPEN_ENDED.days}d ago" if r.open_ended else ""
        note = "; ".join(x for x in (r.note, open_ended, skipped) if x)
        lines.append(
            f"| {r.source} | {r.country} | {f.entries} | {len(f.current)} ({f.read}) | "
            f"{r.api_alerts}{'+' if r.api_capped else ''} | {f'{r.found}/{r.probed}' if r.probed else '–'} | "
            f"{_ago(min(issued, default=None), now)} | {_ago(max(issued, default=None), now)} | "
            f"{_ago(r.api_oldest, now)} | {_ago(r.api_newest, now)} | **{r.status}** | {note} |")
    lines += ["", "*Current*: what the poller would store now (Moby's own normalizer). *(read)*: CAP documents "
              "read, newest first. *API alerts*: distinct alerts from the source at the country's representative "
              f"points ({COUNTRY_RADIUS_KM} km) and at the sampled items; `+` = a page hit the API's limit. "
              f"*Items found*: sampled feed items with an alert from the source within {ITEM_RADIUS_KM} km "
              f"({QUAKE_RADIUS_KM} km for quakes, which may be merged into another network's copy)."]
    return "\n".join(lines)


def api_base(arg: str | None) -> str | None:
    url = arg or os.environ.get("MOBY_API_URL")
    if not url:
        env = ROOT / ".env"
        for candidate in (env, ROOT.parents[2] / ".env"):      # a worktree under .claude/worktrees/
            if candidate.exists():
                for line in candidate.read_text().splitlines():
                    if line.startswith("EXPO_PUBLIC_API_URL="):
                        url = line.split("=", 1)[1].strip().strip("'\"")
                if url:
                    break
    if not url:
        return None
    url = url.rstrip("/")
    return url[: -len("/v1")] if url.endswith("/v1") else url


def main() -> None:
    p = argparse.ArgumentParser(description="Do non-US official feeds reach GET /v1/alerts?")
    p.add_argument("--api", help="API base URL (default: MOBY_API_URL, or EXPO_PUBLIC_API_URL in .env)")
    p.add_argument("--source", action="append", help="only these sources (repeatable), e.g. cn-cma-xx, jma")
    p.add_argument("--max-docs", type=int, default=MAX_DOCS, help="CAP documents to read per source")
    p.add_argument("--json", type=Path, help="also write the rows as JSON here")
    p.add_argument("--strict", action="store_true", help="exit 1 if any source is BROKEN")
    args = p.parse_args()
    base = api_base(args.api)
    if not base:
        p.error("no API URL: pass --api, set MOBY_API_URL, or EXPO_PUBLIC_API_URL in .env")

    rows = asyncio.run(run(set(args.source or []) or None, base, args.max_docs))
    now = datetime.now(timezone.utc)
    print(markdown(rows, now))
    if args.json:
        args.json.write_text(json.dumps([{
            "source": r.source, "country": r.country, "status": r.status, "note": r.note,
            "feed_entries": r.feed.entries, "feed_read": r.feed.read, "feed_current": len(r.feed.current),
            "feed_skipped": dict(r.feed.skipped), "feed_error": r.feed.error,
            "api_alerts": r.api_alerts, "api_capped": r.api_capped, "probed": r.probed, "found": r.found,
            "open_ended": r.open_ended,
            "api_oldest": r.api_oldest.isoformat() if r.api_oldest else None,
            "api_newest": r.api_newest.isoformat() if r.api_newest else None,
        } for r in rows], indent=2))
    if args.strict and any(r.status == "BROKEN" for r in rows):
        sys.exit(1)


if __name__ == "__main__":
    main()
