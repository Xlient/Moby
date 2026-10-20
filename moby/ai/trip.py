"""'Before you go': a trip briefing a traveller can save and read with no signal.

    destination or route (stops) + radius → PostGIS (official alerts, community reports)
      → Tavily (the country's official websites only) → Nemotron Ultra explains why each
        one matters for the trip, citing it → grounding checks → app (saved for offline)

Code decides, AI explains:
  - PostGIS picks every alert and report (ST_DWithin on events.area / events.location) near the
    destination point, or near a route: straight lines between the stops, in order (not the trail).
    The model only explains the rows it is given: it may not add hazards, places or numbers.
  - Every statement cites O<n> (official alert), C<n> (community reports) or W<n> (official
    web page). Its numbers, proper names and hazard words must appear in what it cites, and
    most of its other words too; statements that fail are dropped, with one retry at most.
  - Which statements rest on community reports is decided by code (their citations), and
    those may not call themselves official or confirmed. The app labels them unverified.
  - Nothing here changes tier, severity or delivery; nothing is written back to events.
  - "What this can't tell you" is written by code and is never empty.

Cost: Ultra claims the `trip_brief` cap (a retry claims another unit) and Tavily the shared
`tavily` cap. Past either, the briefing comes back without that part and says so. The
paid part is cached per (snapped point, radius, day, trip, inputs): repeats are free, and
a new or updated alert changes the inputs, so it is never explained from a stale cache.

Privacy: the destination (or every stop) is snapped to 0.01° (~1 km) before it is used at all. The cache
keeps only that point (no user id) and is purged after two days. Tavily queries are built
from structured fields (hazard types, the place picked from Moby's list, the country),
never from free text. Report notes never reach the model or the app.
"""
import asyncio
import hashlib
import json
import logging
import re
import time
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import cache
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, Field

from moby.alerts.preferences import collapse_repeats
from moby.api.alerts import to_alert
from moby.search.official import OFFICIAL

from . import budget
from .grounding import norm, stray_numbers, support

log = logging.getLogger("moby.ai.trip")

MAX_STOPS = 8                    # a route: straight lines between up to 8 stops
MAX_ROUTE_KM = 500
SNAP_DECIMALS = 2                # ~1 km: privacy, and what the cache key is built from
MAX_OFFICIAL = 12
MAX_COMMUNITY = 12
COMMUNITY_WINDOW_H = 72          # "recent" community reports
NO_EXPIRY_WINDOW_H = 48          # official events without an expiry (quakes) count this long
MAX_CLAIMS = 6
MIN_CLAIM_SUPPORT = 0.5
RATE_LIMIT = 10                  # briefings per user per hour
CACHE_DAYS = 2
MODEL_TIMEOUT_S = 75

SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
HAZARD_WORDS = {"flood": "flooding", "fire": "wildfire", "earthquake": "earthquake", "storm": "storm",
                "landslide": "landslide", "other": "natural hazard"}
EFFECT_WORDS = {"rising_water": "rising water", "structural_damage": "damage to buildings or structures",
                "smoke_or_fire_visible": "smoke or flames", "ground_shaking": "ground shaking",
                "blocked_road": "a blocked road or path", "other": "something else"}
# Country names for search queries and the prompt (every country with official domains).
COUNTRY_NAMES = {"US": "United States", "JP": "Japan", "ID": "Indonesia", "PH": "Philippines", "MX": "Mexico",
                 "IT": "Italy", "GR": "Greece", "IS": "Iceland", "NZ": "New Zealand", "NP": "Nepal", "ES": "Spain",
                 "PT": "Portugal", "IN": "India", "TH": "Thailand"}

# A statement may not name a hazard its sources don't mention.
HAZARD_TERMS = {"flood", "flooding", "floods", "flash", "landslide", "landslides", "mudslide", "avalanche",
                "avalanches", "earthquake", "earthquakes", "aftershock", "aftershocks", "tsunami", "wildfire",
                "wildfires", "fire", "fires", "smoke", "storm", "storms", "thunderstorm", "thunderstorms",
                "cyclone", "typhoon", "hurricane", "tornado", "blizzard", "snow", "snowfall", "heatwave", "heat",
                "drought", "volcano", "eruption", "ash", "lightning", "hail", "wind", "winds", "rain", "rainfall",
                "glacial", "glof", "outburst", "debris"}
# Community-backed statements may not borrow official authority.
OFFICIAL_WORDING = re.compile(r"\b(official(ly)?|confirmed|verified|authorities|government|agency)\b", re.I)
# A negated clause ("…not confirmed by any official source") is disclaiming authority, not claiming it:
# it's ignored up to the next comma, semicolon or full stop. Seen with Ultra.
NEGATED = re.compile(r"\b(not|never|nor|no|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|hasn['’]t|haven['’]t)\b[^.;,]*",
                     re.I)
CITE_MARK = re.compile(r"[\[(]?\b([OCW]\d{1,2})\b[\])]?")
# Words that frame a statement without adding a fact ("an official alert reports…", "for your
# trip"). Short sources (a quake is two lines) otherwise fail the word-support check on these
# alone (seen with Ultra). Hazards, names and numbers are checked separately and stay strict.
FRAMING = ("official alert alerts agency warning warnings report reports reported say says said people nearby "
           "trip travel traveller travellers trek trekking visit stay route routes plan plans area areas "
           "destination around near close roughly approximately severity severe rated level means matters could may might "
           "unverified information")
# Spelled-out numbers are checked like digits ("three reports" needs a 3 in the source).
NUMBER_WORDS = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
    "seventeen eighteen nineteen twenty".split())}
# Month names are dates, not places: they're checked as their number instead ("21 October" needs
# a 10 in the source, e.g. "2026-10-21"). Seen with Ultra.
MONTHS = {m: str(i) for i, m in enumerate(
    "january february march april may june july august september october november december".split(), 1)}
MONTHS |= {m[:3]: n for m, n in MONTHS.items()} | {"sept": "9"}      # "Oct 21" (seen with Ultra)
WEEKDAYS = set("monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun".split())
# Capitalised words that may appear without a source (sentence starts are skipped anyway).
ALLOWED_NAMES = {"moby", "i", "utc", *MONTHS, *WEEKDAYS}


def _stem(word: str) -> str:
    """flood/floods/flooding/flooded → flood, for the hazard check only."""
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


# ── Rate limit (per process, like Ask Moby) ─────────────────────────────────

_asked: dict[str, deque[float]] = defaultdict(deque)


def allow(uid: str, now: float | None = None) -> bool:
    now = time.monotonic() if now is None else now
    q = _asked[uid]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return False
    q.append(now)
    return True


# ── PostGIS: code decides what is in the briefing ───────────────────────────

def snap(x: float) -> float:
    return round(x, SNAP_DECIMALS)


@dataclass(frozen=True)
class Stop:
    """One point of the trip: the destination, or a stop on a route (picked from the app's place list)."""
    lat: float
    lon: float
    name: str | None = None


def snapped(stops: list["Stop"]) -> list["Stop"]:
    return [Stop(snap(s.lat), snap(s.lon), s.name.strip()[:80] if s.name and s.name.strip() else None) for s in stops]


def trip_wkt(stops: list["Stop"]) -> str:
    """One stop: the point. Several: straight lines between them, in order (not the actual trail)."""
    coords = ", ".join(f"{s.lon} {s.lat}" for s in stops)
    return f"SRID=4326;POINT({coords})" if len(stops) == 1 else f"SRID=4326;LINESTRING({coords})"


def route_length_km(stops: list["Stop"]) -> float:
    """Sum of the straight legs between stops (haversine)."""
    from itertools import pairwise
    from math import asin, cos, radians, sin, sqrt

    total = 0.0
    for a, b in pairwise(stops):
        dlat, dlon = radians(b.lat - a.lat), radians(b.lon - a.lon)
        h = sin(dlat / 2) ** 2 + cos(radians(a.lat)) * cos(radians(b.lat)) * sin(dlon / 2) ** 2
        total += 2 * 6371.0 * asin(sqrt(h))
    return total


def _geo_params(stops: list["Stop"]) -> dict:
    return {"wkt": trip_wkt(stops), "stop_names": [s.name or "" for s in stops],
            "stop_lats": [s.lat for s in stops], "stop_lons": [s.lon for s in stops]}


_COLUMNS = """e.event_id, e.source, e.source_feed, e.external_id, e.hazard_type, e.observed_effect, e.product,
    e.marine, e.severity, e.tier, e.title, e.description, e.alert_headline, e.alert_body,
    e.distinct_reporter_count, e.reports_disagree, e.language, e.title_en, e.description_en,
    e.translation_status, e.country, e.first_reported_at, e.last_updated_at, e.expires_at, e.raw_payload,
    ST_Y(e.location::geometry) AS lat, ST_X(e.location::geometry) AS lon"""

# The stop each row is nearest to (routes): named in the source text, so the model can say "near Phakding".
# A warning area can cover several stops (all at distance 0): then the one nearest its centre point wins.
def _near_stop(geom: str) -> str:
    stop = "ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326)::geography"
    return f"""(SELECT NULLIF(s.name, '') FROM unnest(%(stop_names)s::text[], %(stop_lons)s::float8[],
                                                 %(stop_lats)s::float8[]) AS s(name, lon, lat)
             ORDER BY ST_Distance({geom}, {stop}), ST_Distance(e.location, {stop}) LIMIT 1)"""


# p.g is the destination point or the route line (trip_wkt). Inside a warning's area counts as
# distance 0. Area and point are tested separately so each can use its GiST index (0002, 0009).
OFFICIAL_SQL = f"""
WITH p AS (SELECT ST_GeogFromText(%(wkt)s) AS g)
SELECT {_COLUMNS}, ST_Distance(COALESCE(e.area, e.location), p.g) / 1000.0 AS distance_km,
       {_near_stop("COALESCE(e.area, e.location)")} AS near_stop
FROM events e, p
WHERE e.source = 'official'
  AND e.reviewer_decision IS DISTINCT FROM 'reject'
  AND e.duplicate_of IS NULL
  AND (e.expires_at > %(now)s
       OR (e.expires_at IS NULL AND e.last_updated_at > %(now)s - make_interval(hours => %(no_expiry_h)s)))
  AND ((e.area IS NOT NULL AND ST_DWithin(e.area, p.g, %(radius_m)s))
       OR (e.area IS NULL AND ST_DWithin(e.location, p.g, %(radius_m)s)))
ORDER BY array_position(ARRAY['critical','high','medium','low'], e.severity), distance_km,
         e.first_reported_at DESC, e.event_id
LIMIT %(limit)s
"""

# Community events (fused groups of reports), recent ones only. Notes are never selected.
COMMUNITY_SQL = f"""
WITH p AS (SELECT ST_GeogFromText(%(wkt)s) AS g)
SELECT {_COLUMNS}, ST_Distance(e.location, p.g) / 1000.0 AS distance_km, {_near_stop("e.location")} AS near_stop,
       (SELECT max(r.observed_at) FROM reports r WHERE r.event_id = e.event_id) AS last_report_at
FROM events e, p
WHERE e.source IN ('manual', 'mesh')
  AND e.reviewer_decision IS DISTINCT FROM 'reject'
  AND e.duplicate_of IS NULL
  AND e.last_updated_at > %(now)s - make_interval(hours => %(window_h)s)
  AND (e.expires_at IS NULL OR e.expires_at > %(now)s)
  AND ST_DWithin(e.location, p.g, %(radius_m)s)
ORDER BY e.distinct_reporter_count DESC, array_position(ARRAY['critical','high','medium','low'], e.severity),
         distance_km, e.event_id
LIMIT %(limit)s
"""


async def official_near(conn: AsyncConnection, stops: list[Stop], radius_km: float,
                        now: datetime) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(OFFICIAL_SQL, {**_geo_params(stops), "radius_m": radius_km * 1000, "now": now,
                                         "no_expiry_h": NO_EXPIRY_WINDOW_H, "limit": MAX_OFFICIAL * 2})
        return collapse_repeats(await cur.fetchall())[:MAX_OFFICIAL]


async def community_near(conn: AsyncConnection, stops: list[Stop], radius_km: float,
                         now: datetime) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(COMMUNITY_SQL, {**_geo_params(stops), "radius_m": radius_km * 1000, "now": now,
                                          "window_h": COMMUNITY_WINDOW_H, "limit": MAX_COMMUNITY})
        return await cur.fetchall()


# ── Sources the model sees (and that its statements are checked against) ───

@dataclass
class Cited:
    id: str          # O1, C1, W1
    kind: str        # official | community | web
    title: str
    text: str
    url: str | None = None
    publisher: str | None = None


def _ends_before(row: dict, start: date) -> bool:
    exp = row.get("expires_at")
    return exp is not None and exp < datetime.combine(start, datetime.min.time(), timezone.utc)


def _where(row: dict, route: bool) -> str:
    d, what = row["distance_km"], "route" if route else "destination"
    if d < 0.05:
        text = "The route passes through the warning area." if route else "The destination area overlaps the warning area."
    else:
        text = f"About {d:.1f} km from the {what}." if d < 10 else f"About {d:.0f} km from the {what}."
    if route and row.get("near_stop"):
        text += f" Nearest stop: {row['near_stop']}."
    return text


def official_source(i: int, row: dict, start: date, route: bool = False) -> Cited:
    a = to_alert(row)
    lines = [
        f"{a['headline']}. Issued by {a.get('source_attribution') or 'an official agency'}.",
        f"Hazard: {HAZARD_WORDS[row['hazard_type']]}. Severity: {row['severity']}.",
        f"Area: {a['location_name']}." if a.get("location_name") else "",
        _where(row, route),
        f"Expires {row['expires_at']:%Y-%m-%d %H:%M} UTC." if row.get("expires_at") else "",
        "It expires before the trip starts." if _ends_before(row, start) else "",
        f"Text: {a['body']}" if a.get("body") else "",
    ]
    return Cited(f"O{i}", "official", a["headline"], "\n".join(x for x in lines if x),
                 publisher=a.get("source_attribution"))


def community_source(i: int, row: dict, now: datetime, route: bool = False) -> Cited:
    a = to_alert(row)
    people = max(row.get("distinct_reporter_count") or 0, 1)
    last = row.get("last_report_at") or row["last_updated_at"]
    hours = max(0, int((now - last).total_seconds() // 3600))
    lines = [
        f"{a['headline']}. Reports from people nearby, not verified by any official source.",
        f"Hazard: {HAZARD_WORDS[row['hazard_type']]}."
        + (f" What people saw: {EFFECT_WORDS.get(row['observed_effect'], 'something else')}."
           if row.get("observed_effect") else ""),
        f"Severity people reported: {row['severity']}."
        + (" The reports disagree about how severe it is." if row.get("reports_disagree") else ""),
        f"Reported by {people} different {'person' if people == 1 else 'people'}.",
        "Last report less than an hour ago." if hours == 0
        else f"Last report about {hours} hour{'' if hours == 1 else 's'} ago.",
        _where(row, route),
    ]
    return Cited(f"C{i}", "community", a["headline"], "\n".join(lines), publisher="People nearby (unverified)")


def _domain(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0]


SAFE_PLACE = re.compile(r"^[\w][\w\s.'’,-]{0,59}$")


def search_query(hazards: list[str], place: str | None, country: str) -> str:
    """Structured fields only: hazard types, the picked place name, the country."""
    what = " ".join(HAZARD_WORDS[h] for h in hazards[:3]) or "natural hazard"
    where = place.strip() if place and SAFE_PLACE.match(place.strip()) else ""
    return " ".join(f"{what} warning travel safety {where} {COUNTRY_NAMES.get(country, '')}".split())[:150]


async def web_sources(pool: AsyncConnectionPool, hazards: list[str], place: str | None,
                      country: str | None) -> tuple[list[Cited], str]:
    """Official pages via Tavily, and what happened: searched | no_official_sites | no_key | over_cap | failed."""
    domains = OFFICIAL.get(country or "")
    if not domains:
        return [], "no_official_sites"
    from moby.search.tavily import Tavily, TavilyError, TavilyNotConfigured

    try:
        tavily = Tavily(timeout=10)
    except TavilyNotConfigured:
        return [], "no_key"
    async with pool.connection() as conn:
        if not await budget.take(conn, "tavily"):
            return [], "over_cap"
    try:
        results = await asyncio.to_thread(tavily.search, search_query(hazards, place, country),
                                          include_domains=domains, max_results=3)
    except Exception as e:  # noqa: BLE001 - search is optional; brief from what we have
        log.warning("Tavily search failed: %s", e if isinstance(e, TavilyError) else type(e).__name__)
        return [], "failed"
    return [Cited(f"W{i}", "web", r.title or _domain(r.url), r.content[:1200], url=r.url, publisher=_domain(r.url))
            for i, r in enumerate(unique_pages(results), 1)], "searched"


def unique_pages(results: list) -> list:
    """One result per page: Tavily can return the same page as http:// and http://www. (seen on drrportal.gov.np)."""
    seen, out = set(), []
    for r in results:
        key = re.sub(r"^https?://(www\.)?", "", r.url).rstrip("/").lower()
        if r.content and key not in seen:
            seen.add(key)
            out.append(r)
    return out


# ── Nemotron Ultra explains; code checks every statement ────────────────────

class TripClaim(BaseModel):
    text: str = Field(description="One or two plain sentences: what the source says and why it matters "
                                  "for this trip.")
    cites: list[str] = Field(description="Ids of the sources this statement rests on, e.g. ['O1'] or ['C1'].")


class TripExplanation(BaseModel):
    """Why the alerts, reports and pages found for a trip matter to the traveller."""

    # First on purpose: the model writes fields in order, so it reasons before answering.
    reasoning: str = Field(description="Think about which sources matter most for this trip, and what each "
                                       "one actually says, before writing the statements.")
    claims: list[TripClaim] = Field(description=f"At most {MAX_CLAIMS} statements, most important first.")


SYSTEM = f"""You are Moby, a hazard-safety assistant. A traveller is about to go somewhere. Moby's database has
already found the official alerts (O), reports from people nearby (C) and official web pages (W) for that
area. Explain briefly why each one matters for this trip.

Rules:
- Use ONLY the sources. Don't add hazards, places, numbers, dates, causes or forecasts they don't contain.
- Every statement cites the source ids it rests on.
- Reports from people nearby (C) are unverified: write "people nearby report…". Never call them official
  or confirmed, and never present them as an agency's warning.
- Never say a place, route or plan is safe, or that a danger has passed, unless a source says so.
- No phone numbers, report counts or report times: the app shows them exactly. Distances and expiry times
  only when they matter for the trip.
- At most {MAX_CLAIMS} statements of one or two plain English sentences, most important first. Skip
  web pages that say nothing useful about these hazards."""


def user_message(context: str, sources: list[Cited], problems: list[str] | None = None) -> str:
    label = {"official": "official alert", "community": "reports from people nearby, unverified",
             "web": "official website"}
    blocks = "\n\n".join(f"[{s.id}] ({label[s.kind]}){f' {s.url}' if s.url else ''}\n{s.text}" for s in sources)
    msg = f"Trip: {context}\n\nSources:\n{blocks}"
    if problems:
        msg += ("\n\nYour previous statements were rejected because they weren't supported by the sources "
                "they cite:\n- " + "\n- ".join(problems[:6]) + "\nWrite them again using only the sources.")
    return msg


def _proper_names(text: str) -> set[str]:
    """Capitalised words that aren't the first word of a sentence, and acronyms."""
    names = set()
    for sentence in re.split(r"(?<=[.!?:;])\s+", text):
        words = re.findall(r"[\w'’-]+", sentence)
        for w in words[1:]:
            if w[:1].isupper() and len(w) > 1:
                names.add(w)
        if words and words[0].isupper() and len(words[0]) > 1:
            names.add(words[0])
    return {n for n in names if n.lower() not in ALLOWED_NAMES}


def check_claim(claim: TripClaim, sources: dict[str, Cited], context: str) -> tuple[dict | None, str | None]:
    """({text, basis, cites}, None) when grounded in what it cites, else (None, why not)."""
    text = claim.text.strip()
    cites = [c.strip().upper() for c in claim.cites] + CITE_MARK.findall(text)
    cites = sorted({c for c in cites if c in sources}, key=lambda c: ("OCW".index(c[0]), int(c[1:])))
    text = " ".join(CITE_MARK.sub("", text).split()).replace(" .", ".").replace(" ,", ",")
    if not cites:
        return None, f"no valid citation: {text[:60]!r}"
    if not text or len(text) > 400:
        return None, "statement empty or too long"
    cited = "\n".join(f"{sources[c].title}\n{sources[c].text}" for c in cites) + f"\n{context}"
    spelled = " ".join(NUMBER_WORDS.get(w) or MONTHS.get(w, w) for w in re.findall(r"[a-z]+", text.lower())
                       if w != "may")      # "may" is nearly always the verb
    if stray := stray_numbers(f"{text} {spelled}", cited):
        return None, f"numbers not in {', '.join(cites)}: {stray}"
    have = set(norm(cited).split())
    if missing := sorted(n for n in _proper_names(text) if norm(n) not in have and norm(n).strip("'’") not in have):
        return None, f"names not in {', '.join(cites)}: {missing}"
    have_stems = {_stem(w) for w in have}
    if extra := sorted(w for w in set(norm(text).split()) if w in HAZARD_TERMS and _stem(w) not in have_stems):
        return None, f"hazards not in {', '.join(cites)}: {extra}"
    if support(text, f"{cited}\n{FRAMING}") < MIN_CLAIM_SUPPORT:
        return None, f"strays from {', '.join(cites)}: {text[:60]!r}"
    community = any(c.startswith("C") for c in cites)
    if community and not any(c.startswith("O") for c in cites) and OFFICIAL_WORDING.search(NEGATED.sub("", text)):
        return None, f"community reports presented as official: {text[:60]!r}"
    return {"text": text, "basis": "community" if community else "official", "cites": cites}, None


def check_all(out: TripExplanation, sources: list[Cited], context: str) -> tuple[list[dict], list[str]]:
    by_id = {s.id: s for s in sources}
    kept, problems = [], []
    for claim in out.claims[:MAX_CLAIMS + 2]:
        ok, problem = check_claim(claim, by_id, context)
        if ok and len(kept) < MAX_CLAIMS:
            kept.append(ok)
        elif problem:
            problems.append(problem)
    return kept, problems


@cache
def _ultra():
    """(structured Ultra, model name), or None without a Token Factory key."""
    from moby.config import get_settings
    from moby.llm import chat_model, model_name

    if get_settings().token_factory_api_key is None:
        return None
    # function_calling: what worked best for structured output on Token Factory (moby/graph/structure.py).
    llm = chat_model("ultra", temperature=0, max_tokens=4000, timeout=MODEL_TIMEOUT_S, max_retries=1)
    return llm.with_structured_output(TripExplanation, method="function_calling"), model_name("ultra")


async def _attempt(llm, context: str, sources: list[Cited], problems=None) -> TripExplanation:
    out = await llm.ainvoke([("system", SYSTEM), ("user", user_message(context, sources, problems))])
    return out if isinstance(out, TripExplanation) else TripExplanation.model_validate(out)


async def explain(pool: AsyncConnectionPool, context: str, sources: list[Cited]) -> tuple[dict | None, str]:
    """(explanation, ai_status): ok | partial | withheld | over_cap | unavailable."""
    ultra = _ultra()
    if ultra is None:
        return None, "unavailable"
    llm, model = ultra
    best: list[dict] = []
    best_problems: list[str] = []
    problems: list[str] | None = None
    for attempt in range(2):                   # one retry at most, and only when it's worth it
        async with pool.connection() as conn:
            if not await budget.take(conn, "trip_brief"):
                if attempt == 0:
                    return None, "over_cap"
                break
        try:
            out = await _attempt(llm, context, sources, problems)
        except Exception as e:  # noqa: BLE001 - model, network or schema problems all mean "no text"
            log.info("trip brief attempt %d failed: %s", attempt + 1, type(e).__name__)
            if attempt == 0:
                continue
            break
        kept, problems = check_all(out, sources, context)
        if problems:      # which check dropped which statement (no user data: model text and source ids)
            log.warning("trip brief attempt %d: kept %d, rejected %d: %s", attempt + 1, len(kept), len(problems),
                        problems)
        if len(kept) > len(best):
            best, best_problems = kept, problems
        if kept and len(problems) <= len(kept):
            break
    if not best:
        return None, "withheld"
    return {"model": model, "claims": best}, "partial" if best_problems else "ok"


# ── Cache (only the paid part) ──────────────────────────────────────────────

def inputs_fingerprint(official: list[dict], community: list[dict]) -> str:
    parts = [f"{r['event_id']}:{r['last_updated_at'].isoformat()}" for r in official + community]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def cache_key(day: date, stops: list[Stop], radius_km: float, country: str | None, start: date, end: date,
              inputs: str) -> str:
    raw = json.dumps([day.isoformat(), [[s.lat, s.lon, (s.name or "").lower()] for s in stops], radius_km, country,
                      start.isoformat(), end.isoformat(), inputs])
    return hashlib.sha256(raw.encode()).hexdigest()


async def cache_get(conn: AsyncConnection, key: str) -> dict | None:
    row = await (await conn.execute("SELECT payload FROM trip_brief_cache WHERE cache_key = %s", (key,))).fetchone()
    return row[0] if row else None


async def cache_put(conn: AsyncConnection, key: str, day: date, lat: float, lon: float, radius_km: float,
                    payload: dict) -> None:
    await conn.execute("DELETE FROM trip_brief_cache WHERE day < %s", (day - timedelta(days=CACHE_DAYS - 1),))
    await conn.execute(
        """INSERT INTO trip_brief_cache (cache_key, day, lat, lon, radius_km, payload)
           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload""",
        (key, day, lat, lon, radius_km, Jsonb(payload)))


# ── "What this can't tell you": code, never empty ───────────────────────────

AI_NOTES = {
    "partial": "Some of Moby's AI statements were removed because they couldn't be checked against the "
               "sources they cite.",
    "withheld": "Moby's AI explanation was withheld because it couldn't be checked against the sources. The "
                "alerts and reports listed are complete.",
    "over_cap": "No AI explanation: Moby has written all the briefings it can for today. The alerts, reports "
                "and emergency numbers listed are complete; this list wasn't written by AI.",
    "unavailable": "No AI explanation: it isn't available right now. The alerts, reports and emergency numbers "
                   "listed are complete; this list wasn't written by AI.",
}
WEB_NOTES = {
    "no_official_sites": "Moby has no list of official websites for this country, so none were searched.",
    "no_key": "Official websites weren't searched (web search isn't set up here).",
    "over_cap": "Official websites weren't searched: Moby has used all its web searches for today.",
    "failed": "Official websites couldn't be searched just now.",
}


def uncertainty(*, generated_at: datetime, radius_km: float, start: date, official: list, community: list,
                ai_status: str, web_status: str, today: date, route: bool = False) -> list[str]:
    notes = [
        f"This briefing shows what Moby knew at {generated_at:%Y-%m-%d %H:%M} UTC. Saved for offline, it goes "
        "stale: it can't know about warnings issued or changed after it was saved. Check again whenever you "
        "have signal, and follow local authorities.",
        f"Alerts and reports are matched to within {radius_km:g} km of straight lines between your stops, not "
        "the actual trail or road, which can wander further." if route else
        f"Alerts and reports are matched to a {radius_km:g} km circle around the point you picked, not to your "
        "exact route.",
    ]
    if not official:
        notes.append("No active official alerts cover this area right now. That doesn't mean it's safe: Moby "
                     "only sees agencies whose warnings it can read, and conditions change quickly.")
    else:
        notes.append("Moby only sees agencies whose warnings it can read; local notices such as trail or road "
                     "closures may not be included.")
    if community:
        notes.append("Reports from people nearby are unverified: no official source has confirmed them.")
    else:
        notes.append(f"No reports from people nearby in the last {COMMUNITY_WINDOW_H} hours. Few Moby users "
                     "may be in this area.")
    if (days := (start - today).days) > 0:
        notes.append(f"Your trip starts in {days} day{'s' if days != 1 else ''}. Warnings for those dates may "
                     "not have been issued yet.")
    if note := AI_NOTES.get(ai_status):
        notes.append(note)
    if note := WEB_NOTES.get(web_status):
        notes.append(note)
    return notes


# ── The briefing ────────────────────────────────────────────────────────────

def _pick_country(country: str | None, official: list[dict]) -> str | None:
    if country:
        return country
    counts = Counter(r["country"] for r in official if r.get("country"))
    return counts.most_common(1)[0][0] if counts else None


async def brief(pool: AsyncConnectionPool, *, lat: float | None = None, lon: float | None = None,
                radius_km: float, start: date, end: date, country: str | None = None, place_name: str | None = None,
                stops: list[Stop] | None = None, now: datetime | None = None) -> dict:
    """A destination (lat/lon, place_name) or a route (2+ stops, in order)."""
    now = now or datetime.now(timezone.utc)
    today = now.date()
    if not stops:
        assert lat is not None and lon is not None
        stops = [Stop(lat, lon, place_name)]
    stops = snapped(stops)
    route = len(stops) > 1
    async with pool.connection() as conn:
        official = await official_near(conn, stops, radius_km, now)
        community = await community_near(conn, stops, radius_km, now)
    country = _pick_country(country, official)
    sources = ([official_source(i, r, start, route) for i, r in enumerate(official, 1)]
               + [community_source(i, r, now, route) for i, r in enumerate(community, 1)])
    hazards = sorted({r["hazard_type"] for r in official + community}, key=list(HAZARD_WORDS).index)
    in_country = f", {COUNTRY_NAMES[country]}" if country in COUNTRY_NAMES else ""
    names = [s.name for s in stops if s.name]
    if route:
        where = f"the route {' → '.join(s.name or 'a dropped pin' for s in stops)}{in_country}, within {radius_km:g} km of it"
    else:
        where = f"{stops[0].name or 'the picked point'}{in_country}, within {radius_km:g} km"
    context = f"{where}, from {start.isoformat()} to {end.isoformat()}"
    # Search the route's ends (or the destination): place names from Moby's list only.
    search_place = " ".join(dict.fromkeys([names[0], names[-1]])) if names else None

    key = cache_key(today, stops, radius_km, country, start, end, inputs_fingerprint(official, community))
    async with pool.connection() as conn:
        payload = await cache_get(conn, key)
    cached = payload is not None
    if payload is None:
        web, web_status = await web_sources(pool, hazards, search_place, country)
        if sources:
            explanation, ai_status = await explain(pool, context, sources + web)
        else:
            explanation, ai_status = None, "nothing_to_explain"   # nothing found: no model call
        payload = {
            "explanation": explanation, "ai_status": ai_status, "web_status": web_status,
            "web_sources": [{"cite_id": w.id, "title": w.title[:200], "url": w.url, "publisher": w.publisher}
                            for w in web],
        }
        if ai_status not in ("over_cap", "unavailable") and web_status != "failed":
            async with pool.connection() as conn:
                await cache_put(conn, key, today, stops[-1].lat, stops[-1].lon, radius_km, payload)

    def near(r: dict) -> dict:
        return {"near_stop": r["near_stop"]} if route and r.get("near_stop") else {}

    last = stops[-1]
    out = {
        "generated_at": now.isoformat(),
        "destination": {"lat": last.lat, "lon": last.lon, "radius_km": radius_km,
                        **({"place_name": last.name} if last.name else {}), **({"country": country} if country else {})},
        **({"route": {"stops": [{"lat": s.lat, "lon": s.lon, **({"name": s.name} if s.name else {})} for s in stops],
                      "length_km": round(route_length_km(stops), 1)}} if route else {}),
        "trip": {"start_date": start.isoformat(), "end_date": end.isoformat()},
        "official_alerts": [
            {**to_alert(r), "cite_id": f"O{i}", "ends_before_trip": _ends_before(r, start), **near(r)}
            for i, r in enumerate(official, 1)],
        "community_reports": [
            {**to_alert(r), "cite_id": f"C{i}", "reporter_count": max(r.get("distinct_reporter_count") or 0, 1),
             "last_report_at": (r.get("last_report_at") or r["last_updated_at"]).isoformat(), **near(r)}
            for i, r in enumerate(community, 1)],
        "hazards": hazards,
        "web_sources": payload["web_sources"],
        "searched_web": payload["web_status"] == "searched",
        "web_status": payload["web_status"],
        "ai_status": payload["ai_status"],
        "cached": cached,
        "uncertainty": uncertainty(generated_at=now, radius_km=radius_km, start=start, official=official,
                                   community=community, ai_status=payload["ai_status"],
                                   web_status=payload["web_status"], today=today, route=route),
        "language": "en",
    }
    if payload["explanation"]:
        out["explanation"] = payload["explanation"]
    return out
