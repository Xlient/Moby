"""Map stored events to the contract's `Alert` shape (api-contract-v1.yaml)."""
from typing import Any

SOURCE_ATTRIBUTION = {
    "noaa": "National Weather Service",
    "usgs": "U.S. Geological Survey",
    "gdacs": "GDACS",
    "eonet": "NASA EONET",
}


def _sentence_case(text: str) -> str:
    text = text.strip()
    return text[:1].upper() + text[1:].lower() if text else text


def _headline(row: dict[str, Any]) -> str:
    """Short, sentence-case headline (home spec 6.6): place names go in location_name."""
    feed, payload = row["source_feed"], row.get("raw_payload") or {}
    props = payload.get("properties") or {}
    if feed == "noaa" and row.get("product"):
        return _sentence_case(row["product"])                     # "Flood warning"
    if feed == "usgs" and props.get("mag") is not None:
        return f"Magnitude {props['mag']:.1f} earthquake"
    return (row.get("title") or row.get("product") or "Alert")[:120]


def _location_name(row: dict[str, Any]) -> str | None:
    feed, payload = row["source_feed"], row.get("raw_payload") or {}
    props = payload.get("properties") or {}
    if feed == "noaa":
        name = (props.get("areaDesc") or "").split(";")[0].strip()
    elif feed == "usgs":
        name = props.get("place") or ""
    elif feed == "gdacs":
        name = props.get("country") or ""
    else:
        name = ""
    return name[:80] or None


def _verification_label(row: dict[str, Any]) -> str:
    # Derived, never stored (migration 0002): official + tier 2 is "official_confirmed".
    if row["tier"] >= 2:
        return "official_confirmed"
    return "corroborated_report" if row["tier"] == 1 else "unverified_report"


def to_alert(row: dict[str, Any]) -> dict[str, Any]:
    alert = {
        "alert_id": str(row["event_id"]),
        "event_id": str(row["event_id"]),
        "headline": _headline(row),
        "body": (row.get("description") or "")[:600] or None,
        "severity": row["severity"],
        "location": {"lat": row["lat"], "lon": row["lon"], "frame": "WGS84"},
        "issued_at": row["first_reported_at"].isoformat(),
        "expires_at": row["expires_at"].isoformat() if row.get("expires_at") else None,
        "verification_label": _verification_label(row),
        "source_attribution": SOURCE_ATTRIBUTION.get(row["source_feed"]),
        "hazard_type": row["hazard_type"],
        "location_name": _location_name(row),
        "product": row.get("product"),
        "marine": bool(row.get("marine")),
        "distance_km": round(row["distance_km"], 1) if row.get("distance_km") is not None else None,
    }
    return {k: v for k, v in alert.items() if v is not None}
