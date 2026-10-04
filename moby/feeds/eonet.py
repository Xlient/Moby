"""NASA EONET v3 natural events.

Docs: https://eonet.gsfc.nasa.gov/docs/v3
Polled every 10 min. No ETag/Last-Modified, so the poller skips unchanged bodies
by content hash.
"""
from datetime import datetime
from typing import Any

from .geo import centroid, region_for
from .schema import HazardType, NormalizedEvent, NormalizeResult, Severity

# Open events from the last 30 days, all categories; region filtering is ours.
URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30"

CATEGORY: dict[str, HazardType] = {
    "wildfires": "fire",
    "severeStorms": "storm",
    "floods": "flood",
    "landslides": "landslide",
    "earthquakes": "earthquake",
    "volcanoes": "other",
    "snow": "storm",
    "dustHaze": "other",
    "tempExtremes": "other",
    "drought": "other",
    "manmade": "other",
}
# Not hazards to people on the ground.
SKIP_CATEGORIES = {"seaLakeIce", "waterColor"}


def severity_for(hazard: HazardType, magnitude: float | None, unit: str | None) -> Severity:
    # EONET has no severity field; magnitude (when present) is the only signal.
    if magnitude is not None and unit:
        unit = unit.lower()
        if unit == "kts":  # storms: Saffir-Simpson-ish thresholds on sustained wind
            return "critical" if magnitude >= 96 else "high" if magnitude >= 64 else "medium" if magnitude >= 34 else "low"
        if unit == "acres":  # wildfires: burned area
            return "high" if magnitude >= 10_000 else "medium" if magnitude >= 1_000 else "low"
    return "medium" if hazard in ("fire", "storm", "flood", "landslide") else "low"


def _ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def normalize(payload: dict[str, Any]) -> NormalizeResult:
    result = NormalizeResult()
    for event in payload.get("events", []):
        categories = [c.get("id") for c in event.get("categories") or []]
        if not categories or all(c in SKIP_CATEGORIES for c in categories):
            result.skipped["category_not_hazard"] += 1
            continue
        hazard: HazardType = next((CATEGORY[c] for c in categories if c in CATEGORY), "other")

        geometries = [g for g in event.get("geometry") or [] if g.get("date")]
        if not geometries:
            result.skipped["no_location"] += 1
            continue
        geometries.sort(key=lambda g: g["date"])
        latest = geometries[-1]                 # a storm track's newest position
        point = centroid(latest)
        if point is None:
            result.skipped["no_location"] += 1
            continue
        region = region_for(*point)
        if region is None:
            region = "INTL"  # worldwide since migration 0009 (travellers)

        first, last = _ts(geometries[0]["date"]), _ts(latest["date"])
        result.events.append(
            NormalizedEvent(
                source_feed="eonet",
                external_id=event["id"],
                hazard_type=hazard,
                product=next((c for c in categories if c in CATEGORY), categories[0]),
                severity=severity_for(hazard, latest.get("magnitudeValue"), latest.get("magnitudeUnit")),
                title=event.get("title"),
                description=event.get("description"),
                first_reported_at=first,
                last_updated_at=last,
                expires_at=_ts(event.get("closed")),
                lat=point[0],
                lon=point[1],
                region=region,
                raw_payload=event,
            )
        )
    return result
