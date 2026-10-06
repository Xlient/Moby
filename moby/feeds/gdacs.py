"""GDACS (Global Disaster Alert and Coordination System) current events.

Docs: https://www.gdacs.org/Knowledge/overview.aspx  (API: /gdacsapi)
Polled every 15 min. No ETag/Last-Modified, so the poller skips unchanged bodies
by content hash.
"""
from datetime import datetime, timezone
from typing import Any

from .geo import centroid, region_for
from .schema import HazardType, NormalizedEvent, NormalizeResult, Severity

URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP"

EVENT_TYPE: dict[str, HazardType] = {
    "EQ": "earthquake",
    "TC": "storm",       # tropical cyclone
    "FL": "flood",
    "WF": "fire",
    "VO": "other",       # volcano
    "TS": "flood",       # tsunami
}
SKIP_TYPES = {"DR"}      # drought: slow-onset, not an early-warning hazard

# GDACS alert levels are impact-based (hazard × exposure × vulnerability).
ALERT_LEVEL: dict[str, Severity] = {"Green": "low", "Orange": "high", "Red": "critical"}


def _ts(value: str | None) -> datetime | None:
    # GDACS timestamps are UTC without an offset.
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc) if value else None


def _is_us(props: dict[str, Any]) -> bool:
    if props.get("iso3") == "USA":
        return True
    return any(c.get("iso3") == "USA" for c in props.get("affectedcountries") or [])


def normalize(payload: dict[str, Any]) -> NormalizeResult:
    result = NormalizeResult()
    for feature in payload.get("features", []):
        p = feature.get("properties") or {}
        etype = p.get("eventtype")
        if etype in SKIP_TYPES:
            result.skipped["slow_onset"] += 1
            continue
        point = centroid(feature.get("geometry"))
        if point is None:
            result.skipped["no_location"] += 1
            continue
        # Prefer GDACS's own country attribution; offshore events (cyclones, quakes)
        # often have none, so fall back to our region boxes.
        region = "US" if _is_us(p) else region_for(*point)
        if region is None:
            region = "INTL"  # worldwide since migration 0009 (travellers)
        first = _ts(p.get("fromdate"))
        if first is None:
            result.skipped["no_timestamp"] += 1
            continue
        result.events.append(
            NormalizedEvent(
                source_feed="gdacs",
                # One event spans many episodes (updates); key on the event so it upserts.
                external_id=f"{etype}-{p.get('eventid')}",
                hazard_type=EVENT_TYPE.get(etype or "", "other"),
                product=etype,
                severity=ALERT_LEVEL.get(p.get("alertlevel") or "", "low"),
                title=p.get("name") or p.get("description"),
                description=(p.get("severitydata") or {}).get("severitytext") or p.get("htmldescription"),
                first_reported_at=first,
                last_updated_at=_ts(p.get("datemodified")) or first,
                expires_at=_ts(p.get("todate")) if p.get("iscurrent") == "false" else None,
                lat=point[0],
                lon=point[1],
                region=region,
                raw_payload=feature,
            )
        )
    return result
