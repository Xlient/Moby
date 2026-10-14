"""USGS earthquakes (GeoJSON summary feeds).

Docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
Polled every 60 s. Sends Last-Modified; we send If-Modified-Since.

The summary feeds are rolling windows (hour/day/week/month). Normally we poll the
hour window; after downtime the poller widens the window to cover the gap, so a
restart never loses quakes (see `url_for_gap`).
"""
from datetime import datetime, timedelta, timezone
from typing import Any

from .geo import region_for
from .schema import NormalizedEvent, NormalizeResult, Severity

BASE = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary"
WINDOWS = [
    (timedelta(minutes=55), "all_hour"),   # margin under the 1 h window
    (timedelta(hours=23), "all_day"),
    (timedelta(days=6, hours=20), "all_week"),
]
FALLBACK_WINDOW = "all_month"
HOUR_URL = f"{BASE}/all_hour.geojson"

# Felt-threshold for this product. Smaller quakes are logged by USGS by the thousand
# and are not hazards to people; the noise would swamp corroboration.
MIN_MAGNITUDE = 2.5

PAGER: dict[str, Severity] = {"red": "critical", "orange": "high", "yellow": "medium", "green": "low"}


def url_for_gap(since_last_success: timedelta | None) -> str:
    """Smallest summary window that covers the time since our last good poll."""
    if since_last_success is None:
        return f"{BASE}/all_day.geojson"  # first run: backfill a day
    for limit, name in WINDOWS:
        if since_last_success <= limit:
            return f"{BASE}/{name}.geojson"
    return f"{BASE}/{FALLBACK_WINDOW}.geojson"


def severity_for(mag: float, pager_alert: str | None, tsunami: bool) -> Severity:
    # PAGER estimates impact (shaking × population), which is what matters to people;
    # magnitude alone is the fallback for quakes PAGER hasn't scored yet.
    if pager_alert in PAGER:
        sev = PAGER[pager_alert]
    elif mag >= 7.0:
        sev = "critical"
    elif mag >= 6.0:
        sev = "high"
    elif mag >= 4.5:
        sev = "medium"
    else:
        sev = "low"
    if tsunami and sev in ("low", "medium"):
        sev = "high"
    return sev


def _ms(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc) if value is not None else None


def normalize(payload: dict[str, Any]) -> NormalizeResult:
    result = NormalizeResult()
    for feature in payload.get("features", []):
        p = feature.get("properties") or {}
        if p.get("type") != "earthquake":           # quarry blasts, explosions, ice quakes...
            result.skipped["not_earthquake"] += 1
            continue
        mag = p.get("mag")
        if mag is None or mag < MIN_MAGNITUDE:
            result.skipped["below_min_magnitude"] += 1
            continue
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            result.skipped["no_location"] += 1
            continue
        lon, lat = float(coords[0]), float(coords[1])
        region = region_for(lat, lon)
        if region is None:
            region = "INTL"  # worldwide since migration 0009 (travellers)
        occurred = _ms(p.get("time"))
        if occurred is None:
            result.skipped["no_timestamp"] += 1
            continue
        result.events.append(
            NormalizedEvent(
                source_feed="usgs",
                external_id=feature["id"],
                hazard_type="earthquake",
                product="earthquake",
                severity=severity_for(float(mag), p.get("alert"), bool(p.get("tsunami"))),
                title=p.get("title"),
                description=p.get("place"),
                first_reported_at=occurred,
                last_updated_at=_ms(p.get("updated")) or occurred,
                lat=lat,
                lon=lon,
                region=region,
                magnitude=float(mag),
                raw_payload=feature,
            )
        )
    return result
