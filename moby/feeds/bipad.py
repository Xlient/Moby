"""Nepal: BIPAD disaster information portal, Government of Nepal (issue #10).

Docs: https://bipadportal.gov.np (API v1). Alerts from the Department of Hydrology and
Meteorology (river flood warnings, heavy rainfall) and the Department of Roads (road
closures, mostly from landslides — what trekkers and travellers need). Air-quality
alerts are skipped: not an early-warning hazard for this product.
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .centers import swath
from .schema import HazardType, NormalizedEvent, NormalizeResult, Severity

URL = "https://bipadportal.gov.np/api/v1/alert/?limit=200&ordering=-started_on&public=true"
AUTHORITY = {"dhm": "Department of Hydrology and Meteorology (Nepal)", "dor": "Department of Roads (Nepal)"}

# referenceType → (hazard, default severity, approximate radius km, product, how long it stays up)
KINDS: dict[str, tuple[HazardType, Severity, float, str, timedelta]] = {
    "river": ("flood", "medium", 5, "River flood warning", timedelta(hours=6)),
    "rain": ("flood", "low", 10, "Heavy rainfall", timedelta(hours=3)),
    "road": ("landslide", "medium", 1, "Road closed", timedelta(hours=24)),
}


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _level(description: str, name: str) -> float | None:
    m = re.search(rf"{name}\s*level\s*:\s*([0-9.]+)", description, re.I)
    return float(m.group(1)) if m else None


def normalize(payload: dict[str, Any], *, now: datetime | None = None) -> NormalizeResult:
    now = now or datetime.now(timezone.utc)
    result = NormalizeResult()
    for a in payload.get("results", []):
        kind = KINDS.get(a.get("referenceType"))
        if kind is None:
            result.skipped[f"type_{a.get('referenceType')}"] += 1
            continue
        hazard, severity, radius, product, ttl = kind
        coords = (a.get("point") or {}).get("coordinates") or []
        started = _ts(a.get("startedOn")) or _ts(a.get("createdOn"))
        if len(coords) < 2 or started is None:
            result.skipped["no_location"] += 1
            continue
        expires = _ts(a.get("expireOn")) or started + ttl
        if expires <= now:
            result.skipped["expired"] += 1
            continue
        desc = " ".join((a.get("description") or "").split())
        if a.get("referenceType") == "river":
            water, danger = _level(desc, "Water"), _level(desc, "Danger")
            if water is not None and danger is not None and water >= danger:
                severity = "high"              # above the danger level, not just the warning level
        if a.get("referenceType") == "road" and "landslide" not in desc.lower():
            hazard = "other"
        lon, lat = float(coords[0]), float(coords[1])
        place = re.sub(r"^.*? (?:at|in) ", "", a.get("title") or "").strip() or None
        result.events.append(NormalizedEvent(
            source_feed="bipad",
            external_id=str(a["id"]),
            hazard_type=hazard,
            product=product,
            severity=severity,
            title=a.get("title"),
            description=desc or None,
            first_reported_at=started,
            last_updated_at=started,
            expires_at=expires,
            lat=lat, lon=lon,
            region="INTL", country="NP",
            area_wkt=swath([(lat, lon, radius)]),
            raw_payload={"properties": {"id": f"bipad:{a['id']}",
                                        "authority": AUTHORITY.get(a.get("source"), "BIPAD (Government of Nepal)"),
                                        "areaDesc": place, "referenceType": a.get("referenceType"),
                                        "titleNe": a.get("titleNe")}},
        ))
    return result
