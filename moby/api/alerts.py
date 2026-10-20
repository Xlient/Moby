"""Map stored events to the contract's `Alert` shape (api-contract-v1.yaml)."""
from typing import Any

SOURCE_ATTRIBUTION = {
    "noaa": "National Weather Service",
    "usgs": "U.S. Geological Survey",
    "gdacs": "GDACS",
    "eonet": "NASA EONET",
    "emsc": "EMSC",
    "ptwc": "Pacific Tsunami Warning Center",
    "nhc": "National Hurricane Center",
    "jtwc": "Joint Typhoon Warning Center",
    "jma": "Japan Meteorological Agency",
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
    if row.get("source") in ("manual", "mesh") and not row.get("title"):
        # A community event whose draft_alert never ran: the same wording it would have used.
        from moby.graph.alert_text import headline
        return headline(row["hazard_type"], row.get("observed_effect"))
    return (row.get("title") or row.get("product") or "Alert")[:120]


def _location_name(row: dict[str, Any]) -> str | None:
    feed, payload = row["source_feed"], row.get("raw_payload") or {}
    props = payload.get("properties") or {}
    if feed in ("noaa", "cap", "ptwc", "jma", "bipad"):
        name = (props.get("areaDesc") or "").split(";")[0].strip()
    elif feed == "usgs":
        name = props.get("place") or ""
    elif feed == "emsc":
        name = (props.get("flynn_region") or "").title()
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


LANGUAGE_NAMES = {"es": "Spanish", "pt": "Portuguese", "it": "Italian", "el": "Greek", "is": "Icelandic",
                  "id": "Indonesian", "ja": "Japanese", "fr": "French", "de": "German", "zh": "Chinese",
                  "th": "Thai", "vi": "Vietnamese", "ne": "Nepali", "hi": "Hindi", "tl": "Filipino"}


def _translated(row: dict[str, Any]) -> bool:
    """Issue #11: show Moby's English translation only when it passed its checks."""
    return row.get("translation_status") == "done" and bool(row.get("title_en"))


def to_alert(row: dict[str, Any], lang: str | None = None) -> dict[str, Any]:
    """The app's Alert. With `lang` (the phone's language, e.g. "ja-JP"), an official alert
    reads in that language when it can: the agency's original if it's the same language, else
    Moby's cached translation into it (moby/ai/alert_text.py), else as without `lang`."""
    from moby.ai import alert_text

    official = row.get("source", "official") == "official" and not row.get("alert_headline")
    original = official and alert_text.same_language(row, lang)
    local = alert_text.cached(row, lang) if official and not original else None
    translated = not original and (bool(local) or _translated(row))
    text = local or ({"headline": row["title_en"], "body": row.get("description_en")} if translated else None)
    alert = {
        "alert_id": str(row["event_id"]),
        "event_id": str(row["event_id"]),
        # Contract 3: draft_alert's wording when present, so the app and the push agree.
        "headline": row.get("alert_headline") or (text["headline"][:120] if text else _headline(row)),
        "body": (row.get("alert_body") or (text or {}).get("body")
                 or row.get("description") or "")[:600] or None,
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
        "country": row.get("country"),
        # How many different people reported it, on community alerts; omitted for official ones.
        "corroboration_count": max(row.get("distinct_reporter_count") or 0, 1)
        if row.get("source") in ("manual", "mesh") else None,
        "reports_disagree": True if row.get("source") in ("manual", "mesh") and row.get("reports_disagree") else None,
        "distance_km": round(row["distance_km"], 1) if row.get("distance_km") is not None else None,
    }
    if translated:
        source = alert_text.base(row.get("language"))
        alert.update({
            "translated": True,
            "original_language": "English" if source == "en" else LANGUAGE_NAMES.get(source, row.get("language")),
            "original_headline": (row.get("title") or "")[:300],
            "original_body": (row.get("description") or "")[:600] or None,
        })
    return {k: v for k, v in alert.items() if v is not None}
