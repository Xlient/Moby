"""Tier and confidence for official-feed events (plan v3 §10).

Deterministic on purpose: urgency logic never goes through a model (§5). Tier is
about *verification*, not severity — a Minor NWS advisory is just as confirmed as
an Extreme warning; who gets notified is decided by severity + user preferences.

    Tier 0  unverified   (logged)
    Tier 1  corroborated (reviewer notified)
    Tier 2  confirmed    (eligible for public alerting)

Policy, by how authoritative the source is for US hazards:
  - NWS (noaa): the legal US warning authority            → tier 2
  - USGS:       authoritative seismic network; automatic
                solutions get a little less confidence     → tier 2
  - GDACS:      UN/EC alerting system, impact-scored       → tier 2
  - CAP:        national warning services abroad (the
                legal warning authority where they operate) → tier 2
  - EONET:      NASA curation of other agencies' reports;
                NASA describes it as situational awareness,
                not an authoritative alert                 → tier 1 (a reviewer promotes it)
"""
from dataclasses import dataclass

from moby.feeds.schema import NormalizedEvent


@dataclass(frozen=True)
class Verification:
    tier: int
    confidence: float


def official_verification(e: NormalizedEvent) -> Verification:
    match e.source_feed:
        case "noaa":
            return Verification(2, 0.95)
        case "usgs":
            reviewed = (e.raw_payload.get("properties") or {}).get("status") == "reviewed"
            return Verification(2, 0.95 if reviewed else 0.85)
        case "gdacs":
            return Verification(2, 0.8)
        case "cap":
            return Verification(2, 0.9)
        case "emsc":
            return Verification(2, 0.85)
        case "ptwc" | "nhc":
            return Verification(2, 0.95)   # official tsunami / hurricane warning centres
        case "jtwc":
            return Verification(2, 0.85)   # US Navy/Air Force typhoon warnings (advisory abroad)
        case "eonet":
            return Verification(1, 0.7)
    return Verification(0, 0.0)
