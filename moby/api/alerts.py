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
    if feed == "cap" and row.get("title"):
        # Agencies often end the headline with the place ("… warning. Ampurdán");
        # the place is shown separately (location_name), so don't repeat it.
        place = (props.get("areaDesc") or "").split(";")[0].strip()
        title = row["title"].strip()
        if place and title.lower().endswith(place.lower()) and len(title) > len(place) + 3:
            title = title[: -len(place)].rstrip(" .,:;-–—")
        return title[:120]
    return (row.get("title") or row.get("product") or "Alert")[:120]


def _location_name(row: dict[str, Any]) -> str | None:
    feed, payload = row["source_feed"], row.get("raw_payload") or {}
    props = payload.get("properties") or {}
    if feed in ("noaa", "cap"):
        name = (props.get("areaDesc") or "").split(";")[0].strip()
    elif feed == "usgs":
        name = props.get("place") or ""
    elif feed == "gdacs":
        name = props.get("country") or ""
    else:
        name = ""
    return name[:80] or None


def _verification_label(row: dict[str, Any]) -> str:
    # Derived, never stored (migration 0002): only an agency's alert is "official_confirmed".
    # A community event at tier 2 (confirmed by people nearby / a reviewer) stays a report.
    official = row.get("source", "official") == "official"
    if row["tier"] >= 2 and official:
        return "official_confirmed"
    return "corroborated_report" if row["tier"] >= 1 else "unverified_report"


def to_alert(row: dict[str, Any]) -> dict[str, Any]:
    alert = {
        "alert_id": str(row["event_id"]),
        "event_id": str(row["event_id"]),
        # Contract 3: draft_alert's wording when present, so the app and the push agree.
        "headline": row.get("alert_headline") or _headline(row),
        "body": (row.get("alert_body") or row.get("description") or "")[:600] or None,
        "severity": row["severity"],
        "location": {"lat": row["lat"], "lon": row["lon"], "frame": "WGS84"},
        "issued_at": row["first_reported_at"].isoformat(),
        "expires_at": row["expires_at"].isoformat() if row.get("expires_at") else None,
        "verification_label": _verification_label(row),
        "source_attribution": SOURCE_ATTRIBUTION.get(row["source_feed"])
        or ((row.get("raw_payload") or {}).get("properties") or {}).get("authority")
        or ("Community reports" if row.get("source") in ("manual", "mesh") else None),
        "hazard_type": row["hazard_type"],
        "location_name": _location_name(row),
        "product": row.get("product"),
        "marine": bool(row.get("marine")),
        # "Confirmed by N nearby" on community alerts; omitted for official ones (contract).
        "corroboration_count": row.get("distinct_reporter_count") or None
        if row.get("source") in ("manual", "mesh") and row["tier"] >= 1 else None,
        "distance_km": round(row["distance_km"], 1) if row.get("distance_km") is not None else None,
    }
    return {k: v for k, v in alert.items() if v is not None}
