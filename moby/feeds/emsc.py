"""EMSC earthquakes (European-Mediterranean Seismological Centre), worldwide.

Docs: https://www.seismicportal.eu/fdsn-wsevent.html (FDSN event service, GeoJSON)
Faster than USGS for Europe, the Mediterranean and Turkey, where many travellers
are. The same quake from USGS and EMSC is merged after upsert (see dedupe.py).
"""
from datetime import datetime, timedelta, timezone
from typing import Any

from .geo import region_for
from .schema import NormalizedEvent, NormalizeResult
from .usgs import STRONG_QUAKE_TTL, quake_ttl, severity_for

BASE = "https://www.seismicportal.eu/fdsnws/event/1/query"
# Felt by people nearby; smaller events are mostly noise for this product.
MIN_MAGNITUDE = 3.0
URL = f"{BASE}?format=json&minmag={MIN_MAGNITUDE}&orderby=time&limit=500"


def url_for_gap(since_last_success: timedelta | None) -> str:
    """Quakes published or revised since the last good poll (an hour minimum, a week max).

    By update time, not origin time: some networks reach EMSC hours after the quake
    (Mexico's UNM in batches), and magnitudes and locations are revised later. Only
    origins within STRONG_QUAKE_TTL are asked for; older ones would be stored already expired."""
    now = datetime.now(timezone.utc)
    gap = since_last_success or timedelta(days=1)
    gap = min(max(gap + timedelta(minutes=10), timedelta(hours=1)), timedelta(days=7))
    start = (now - STRONG_QUAKE_TTL).strftime("%Y-%m-%dT%H:%M:%S")
    updated = (now - gap).strftime("%Y-%m-%dT%H:%M:%S")
    return f"{URL}&start={start}&updatedafter={updated}"


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def normalize(payload: dict[str, Any]) -> NormalizeResult:
    result = NormalizeResult()
    for feature in payload.get("features", []):
        p = feature.get("properties") or {}
        if p.get("evtype") not in (None, "ke"):      # ke = known earthquake; skip blasts etc.
            result.skipped["not_earthquake"] += 1
            continue
        mag = p.get("mag")
        if mag is None or mag < MIN_MAGNITUDE:
            result.skipped["below_min_magnitude"] += 1
            continue
        lat, lon = p.get("lat"), p.get("lon")
        occurred = _ts(p.get("time"))
        if lat is None or lon is None or occurred is None:
            result.skipped["no_location"] += 1
            continue
        region = (p.get("flynn_region") or "").title() or None
        severity = severity_for(float(mag), None, False)
        result.events.append(NormalizedEvent(
            source_feed="emsc",
            external_id=str(p.get("unid") or feature.get("id")),
            hazard_type="earthquake",
            product="earthquake",
            severity=severity,
            title=f"M {float(mag):.1f} - {region}" if region else f"M {float(mag):.1f} earthquake",
            description=region,
            first_reported_at=occurred,
            last_updated_at=_ts(p.get("lastupdate")) or occurred,
            expires_at=occurred + quake_ttl(severity),
            lat=float(lat),
            lon=float(lon),
            region=region_for(float(lat), float(lon)) or "INTL",
            magnitude=float(mag),
            raw_payload=feature,
        ))
    return result
