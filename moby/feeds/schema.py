"""The common shape every official feed is normalized into.

Mirrors the `events` table (db/migrations/0002) for source='official' rows, so the
poller can upsert it directly. Normalizers are pure functions of the feed payload
(no I/O), which keeps them testable against saved fixtures.
"""
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

FeedName = Literal["noaa", "usgs", "eonet", "gdacs"]
HazardType = Literal["flood", "fire", "earthquake", "storm", "landslide", "other"]
Severity = Literal["low", "medium", "high", "critical"]


@dataclass
class NormalizedEvent:
    source_feed: FeedName
    external_id: str
    hazard_type: HazardType
    severity: Severity
    title: str | None
    description: str | None
    first_reported_at: datetime
    last_updated_at: datetime
    raw_payload: dict[str, Any]
    lat: float | None = None
    lon: float | None = None
    location_accuracy_m: float | None = None
    expires_at: datetime | None = None
    region: str = "US"
    # The source's own name for the product ("Flood Warning", "Small Craft Advisory",
    # "earthquake", "TC", "wildfires"), for finer per-user filtering than hazard_type.
    product: str | None = None
    # Offshore/marine product: stored, but only shown to users who opt in.
    marine: bool = False
    # NOAA only: zone URLs to resolve when the alert carries no geometry.
    zone_urls: list[str] = field(default_factory=list)
    # NOAA only: identifiers of earlier messages this one updates or cancels. The
    # poller folds the chain into one event row (see poller.link_chains).
    references: list[str] = field(default_factory=list)
    # NOAA only: a Cancel message — ends the referenced alert instead of adding one.
    cancels: bool = False

    @property
    def has_location(self) -> bool:
        return self.lat is not None and self.lon is not None


@dataclass
class NormalizeResult:
    events: list[NormalizedEvent] = field(default_factory=list)
    # Why items were dropped, e.g. {"marine": 248, "outside_region": 30}. Logged per
    # poll so a filter that silently eats real hazards shows up in the numbers.
    skipped: Counter = field(default_factory=Counter)
