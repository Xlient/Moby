"""NOAA / NWS active alerts (api.weather.gov), CAP-derived GeoJSON.

Docs: https://www.weather.gov/documentation/services-web-api
Polled every 60 s. Sends a (weak) ETag; we send If-None-Match.
"""
from datetime import datetime
from typing import Any

from .geo import centroid
from .schema import HazardType, NormalizedEvent, NormalizeResult, Severity

URL = "https://api.weather.gov/alerts/active?status=actual"

# CAP severity → ours. "Unknown" is treated as low rather than dropped.
SEVERITY: dict[str, Severity] = {
    "Extreme": "critical",
    "Severe": "high",
    "Moderate": "medium",
    "Minor": "low",
    "Unknown": "low",
}

# Marine products (offshore/boating). Kept, but flagged `marine` so users who are
# not on the water don't see them unless they opt in (alert preferences). They are
# ~70% of active NWS alerts. Coastal products (rip currents, high surf, coastal
# flood, storm surge, tsunami) are NOT marine: they affect people on the shore.
MARINE_EVENTS = {
    "Small Craft Advisory",
    "Gale Warning",
    "Gale Watch",
    "Storm Warning",          # NWS uses this name for the marine storm-force wind product
    "Storm Watch",
    "Hurricane Force Wind Warning",
    "Hurricane Force Wind Watch",
    "Hazardous Seas Warning",
    "Hazardous Seas Watch",
    "Special Marine Warning",
    "Marine Weather Statement",
    "Brisk Wind Advisory",
    "Low Water Advisory",
    "Heavy Freezing Spray Warning",
    "Heavy Freezing Spray Watch",
    "Freezing Spray Advisory",
}
# UGC zone prefixes for marine areas (coastal waters, Great Lakes, offshore).
# An alert whose zones are ALL marine is marine whatever its product name.
MARINE_UGC_PREFIXES = ("AM", "AN", "GM", "LC", "LE", "LH", "LM", "LO", "LS", "PH", "PK", "PM", "PS", "PZ", "SL")


def is_marine(event_name: str, ugc_codes: list[str]) -> bool:
    if event_name in MARINE_EVENTS:
        return True
    return bool(ugc_codes) and all(c[:2] in MARINE_UGC_PREFIXES and c[2:3] == "Z" for c in ugc_codes)


# Ordered keyword → hazard rules on the CAP "event" name; first match wins.
_HAZARD_RULES: list[tuple[tuple[str, ...], HazardType]] = [
    (("debris flow", "avalanche", "landslide", "mudslide"), "landslide"),
    (("flood", "hydrologic", "storm surge", "tsunami"), "flood"),
    (("fire", "red flag", "smoke"), "fire"),
    (("earthquake",), "earthquake"),
    (("tornado", "thunderstorm", "hurricane", "tropical", "typhoon", "wind", "winter storm",
      "blizzard", "ice storm", "snow", "dust storm", "squall", "extreme cold",
      "gale", "small craft", "seas", "freezing spray", "marine", "storm"), "storm"),
]


def hazard_for(event_name: str) -> HazardType:
    name = event_name.lower()
    for keywords, hazard in _HAZARD_RULES:
        if any(k in name for k in keywords):
            return hazard
    return "other"


def _ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def normalize(payload: dict[str, Any]) -> NormalizeResult:
    result = NormalizeResult()
    for feature in payload.get("features", []):
        p = feature.get("properties") or {}
        event_name = p.get("event") or ""
        if p.get("status") != "Actual":
            result.skipped["not_actual"] += 1
            continue
        references = [r["identifier"] for r in p.get("references") or [] if r.get("identifier")]

        sent = _ts(p.get("sent")) or _ts(p.get("effective"))
        if sent is None:
            result.skipped["no_timestamp"] += 1
            continue

        ev = NormalizedEvent(
            source_feed="noaa",
            external_id=p["id"],
            hazard_type=hazard_for(event_name),
            severity=SEVERITY.get(p.get("severity") or "Unknown", "low"),
            title=p.get("headline") or event_name or None,
            description=(p.get("description") or "")[:4000] or None,
            first_reported_at=sent,
            last_updated_at=sent,
            expires_at=_ts(p.get("ends")) or _ts(p.get("expires")),
            raw_payload=feature,
            product=event_name or None,
            marine=is_marine(event_name, (p.get("geocode") or {}).get("UGC") or []),
            references=references,
            cancels=p.get("messageType") == "Cancel",
        )
        if ev.cancels:
            # Ends the referenced alert; carries no new hazard, so no location needed.
            if not references:
                result.skipped["cancel_without_reference"] += 1
                continue
            result.events.append(ev)
            continue

        point = centroid(feature.get("geometry"))
        if point:
            ev.lat, ev.lon = point
        else:
            # Located later from the cached zone centroids (poller.resolve_zones).
            ev.zone_urls = list(p.get("affectedZones") or [])
            if not ev.zone_urls:
                result.skipped["no_location"] += 1
                continue
        result.events.append(ev)
    return result
