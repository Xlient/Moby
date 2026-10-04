"""Japan Meteorological Agency: earthquakes and volcano warnings (issue #10).

These are the JSON files behind www.jma.go.jp ("bosai"), not a documented API, so
parsing sticks to fields covered by tests and any parse failure is logged loudly.
Japanese government content may be reused with attribution (credit: JMA).

Earthquakes: '震源・震度情報' (hypocentre and intensity) reports, with the maximum
seismic intensity (shindo, JMA scale) — what people in Japan act on. Smaller than
shindo 3 is skipped. The same quake from USGS/EMSC is merged (dedupe.py).

Volcanoes: current warning per volcano (Volcanic Alert Levels 1–5, or the equivalent
codes for volcanoes without levels). Level 1 ("potential for increased activity")
is not a hazard and is skipped. The list is a snapshot: a volcano that drops out has
returned to normal, so its event ends.
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from psycopg_pool import AsyncConnectionPool

from .centers import swath
from .schema import NormalizedEvent, NormalizeResult, Severity

log = logging.getLogger("moby.feeds.jma")

QUAKE_URL = "https://www.jma.go.jp/bosai/quake/data/list.json"
VOLCANO_URL = "https://www.jma.go.jp/bosai/volcano/data/warning.json"
VOLCANO_LIST_URL = "https://www.jma.go.jp/bosai/volcano/const/volcano_list.json"
AUTHORITY = "Japan Meteorological Agency"

# Shindo (JMA intensity) → severity, and a rough "felt strongly within" radius.
SHINDO: dict[str, tuple[Severity, float]] = {
    "3": ("low", 40), "4": ("medium", 80), "5-": ("high", 120), "5+": ("high", 150),
    "6-": ("critical", 200), "6+": ("critical", 250), "7": ("critical", 300),
}

# Volcanic warning item code → (severity, radius km, English meaning, marine)
VOLCANO: dict[str, tuple[Severity, float, str, bool]] = {
    "12": ("medium", 3, "Level 2: do not approach the crater", False),
    "13": ("high", 6, "Level 3: do not approach the volcano", False),
    "14": ("critical", 15, "Level 4: prepare to evacuate (elderly and others evacuate)", False),
    "15": ("critical", 15, "Level 5: evacuate", False),
    "22": ("medium", 3, "Danger near the crater", False),
    "23": ("high", 6, "Danger on the volcano: do not climb", False),
    "24": ("critical", 15, "Residential areas: be on alert", False),
    "25": ("critical", 15, "Residential areas: evacuate", False),
    "31": ("medium", 10, "Warning for the surrounding sea", True),
    "36": ("medium", 10, "Warning for the surrounding sea", True),
}


def _iso6709(cod: str) -> tuple[float, float] | None:
    """'+39.1+142.1-40000/' → (39.1, 142.1)."""
    m = re.match(r"([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)", cod or "")
    return (float(m.group(1)), float(m.group(2))) if m else None


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone(timedelta(hours=9)))


QUAKE_TTL = timedelta(hours=24)      # an earthquake is a moment; list it for a day


def normalize_quakes(items: list[dict[str, Any]], *, now: datetime | None = None) -> NormalizeResult:
    now = now or datetime.now(timezone.utc)
    result = NormalizeResult()
    seen: set[str] = set()
    for q in items:                                   # newest first: keep the latest report per quake
        if q.get("ttl") != "震源・震度情報":
            result.skipped["not_hypocentre_report"] += 1
            continue
        eid = q.get("eid")
        if not eid or eid in seen:
            continue
        seen.add(eid)
        shindo = q.get("maxi") or ""
        if shindo not in SHINDO:
            result.skipped["below_shindo_3"] += 1
            continue
        ll = _iso6709(q.get("cod", ""))
        occurred = _ts(q.get("at"))
        if ll is None or occurred is None:
            result.skipped["no_location"] += 1
            continue
        if occurred + QUAKE_TTL <= now:
            result.skipped["older_than_a_day"] += 1
            continue
        severity, radius = SHINDO[shindo]
        try:
            mag = float(q.get("mag"))
        except (TypeError, ValueError):
            mag = None
        place = q.get("en_anm") or q.get("anm") or "Japan"
        result.events.append(NormalizedEvent(
            source_feed="jma",
            external_id=f"eq-{eid}",
            hazard_type="earthquake",
            product="earthquake",
            severity=severity,
            title=(f"M {mag:.1f} earthquake" if mag is not None else "Earthquake") + f" - {place}",
            description=(f"Maximum seismic intensity {shindo} on the JMA scale (shindo). "
                         f"The area shown is approximate: where shaking was likely felt strongly."),
            first_reported_at=occurred,
            last_updated_at=_ts(q.get("rdt")) or occurred,
            expires_at=occurred + QUAKE_TTL,
            lat=ll[0], lon=ll[1],
            region="INTL", country="JP",
            magnitude=mag,
            area_wkt=swath([(ll[0], ll[1], radius)]),
            raw_payload={"properties": {"id": f"jma:eq:{eid}:{q.get('ser')}", "authority": AUTHORITY,
                                        "areaDesc": place, "shindo": shindo, "eid": eid}},
        ))
    return result


def normalize_volcanoes(warnings: list[dict[str, Any]], volcanoes: dict[str, dict]) -> NormalizeResult:
    result = NormalizeResult()
    for w in warnings:
        issued = _ts(w.get("reportDatetime")) or datetime.now(timezone.utc)
        for info in w.get("volcanoInfos", []):
            if not info.get("type", "").endswith("（対象火山）"):    # the per-volcano block
                continue
            for item in info.get("items", []):
                code = item.get("code")
                if code not in VOLCANO:
                    result.skipped["level_1_or_unknown"] += 1
                    continue
                severity, radius, meaning, marine = VOLCANO[code]
                for area in item.get("areas", []):
                    v = volcanoes.get(area.get("code"))
                    if v is None:
                        result.skipped["unknown_volcano"] += 1
                        continue
                    lat, lon = float(v["latlon"][0]), float(v["latlon"][1])
                    name = v.get("name_en") or area.get("name")
                    result.events.append(NormalizedEvent(
                        source_feed="jma",
                        external_id=f"vol-{area['code']}",
                        hazard_type="other",
                        product="Volcanic warning",
                        severity=severity,
                        title=f"{name} volcano - {meaning}",
                        description=(f"Japan Meteorological Agency volcanic warning for {name}: {meaning}. "
                                     f"The area shown is approximate (within {radius:g} km); follow local "
                                     "restrictions, which may be wider."),
                        first_reported_at=issued,
                        last_updated_at=issued,
                        lat=lat, lon=lon,
                        region="INTL", country="JP",
                        marine=marine,
                        area_wkt=swath([(lat, lon, radius)]),
                        raw_payload={"properties": {"id": f"jma:vol:{area['code']}:{code}", "authority": AUTHORITY,
                                                    "areaDesc": name, "level_code": code}},
                    ))
    return result


_volcano_list: dict[str, dict] | None = None


async def poll_jma(pool: AsyncConnectionPool, http: httpx.AsyncClient) -> NormalizeResult:
    from .dedupe import merge_duplicate_quakes
    from .poller import ChainedEvent, upsert_events

    global _volcano_list
    if _volcano_list is None:
        r = await http.get(VOLCANO_LIST_URL)
        r.raise_for_status()
        _volcano_list = {v["code"]: v for v in r.json()}
    q = await http.get(QUAKE_URL)
    q.raise_for_status()
    v = await http.get(VOLCANO_URL)
    v.raise_for_status()
    quakes = normalize_quakes(q.json())
    volcanoes = normalize_volcanoes(v.json(), _volcano_list)
    events = quakes.events + volcanoes.events
    async with pool.connection() as conn, conn.transaction():
        await upsert_events(conn, [ChainedEvent(e, [e.raw_payload["properties"]["id"]]) for e in events])
        await merge_duplicate_quakes(conn)
        # Volcano warnings are a snapshot: one no longer listed has gone back to normal.
        await conn.execute(
            """UPDATE events SET expires_at = now()
               WHERE source_feed = 'jma' AND external_id LIKE 'vol-%%' AND NOT (external_id = ANY(%s))
                 AND (expires_at IS NULL OR expires_at > now())""",
            ([e.external_id for e in volcanoes.events],))
        await conn.execute(
            """UPDATE feed_watermarks SET last_polled_at = now(), last_success_at = now(), last_status = 200,
               consecutive_failures = 0, last_error = NULL, updated_at = now() WHERE feed = 'jma'""")
    result = NormalizeResult(events=events)
    result.skipped.update(quakes.skipped)
    result.skipped.update(volcanoes.skipped)
    return result
