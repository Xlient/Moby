"""Per-user alert preferences, and the query that applies them.

A user chooses which kinds of alert they want (hazard types), how serious an alert
must be, and whether to include marine (offshore/boating) products. The same
filter drives GET /alerts and, later, push delivery, so what a user sees in the app
and what wakes their phone can never disagree.

Defaults: every hazard type, every severity, marine off. Marine products are ~70%
of NWS alerts and matter only on the water, so they are opt-in.

Critical alerts always get through: preferences only ever quiet the lesser ones.
Warning people early about what is coming is the point of the product, so no
setting can hide a critical alert within the user's radius.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from moby.feeds.schema import HazardType, Severity

ALL_HAZARDS: frozenset[HazardType] = frozenset({"flood", "fire", "earthquake", "storm", "landslide", "other"})
SEVERITY_ORDER: tuple[Severity, ...] = ("low", "medium", "high", "critical")


@dataclass(frozen=True)
class AlertPreferences:
    hazard_types: frozenset[HazardType] = field(default_factory=lambda: ALL_HAZARDS)
    min_severity: Severity = "low"
    include_marine: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "AlertPreferences":
        """Tolerant parse of the stored/API shape (contract `AlertPreferences`):
        unknown hazard types are ignored, and an empty list falls back to all —
        a user should never silence every alert by accident."""
        data = data or {}
        hazards = frozenset(h for h in data.get("hazard_types") or () if h in ALL_HAZARDS) or ALL_HAZARDS
        sev = data.get("min_severity")
        return cls(
            hazard_types=hazards,
            min_severity=sev if sev in SEVERITY_ORDER else "low",
            include_marine=bool(data.get("include_marine", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "hazard_types": sorted(self.hazard_types),
            "min_severity": self.min_severity,
            "include_marine": self.include_marine,
        }

    def allowed_severities(self) -> list[Severity]:
        return list(SEVERITY_ORDER[SEVERITY_ORDER.index(self.min_severity):])

    def matches(self, hazard_type: str, severity: str, marine: bool) -> bool:
        if severity == "critical":
            return True  # never filtered (see module docstring)
        return (
            hazard_type in self.hazard_types
            and severity in self.allowed_severities()
            and (self.include_marine or not marine)
        )


ALERTS_NEAR_SQL = """
SELECT event_id, source_feed, external_id, hazard_type, product, marine, severity, tier,
       title, description, first_reported_at, last_updated_at, expires_at, raw_payload,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
       ST_Distance(location, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography) / 1000.0 AS distance_km
FROM events
WHERE source = 'official'
  AND tier >= %(min_tier)s
  AND (expires_at IS NULL OR expires_at > %(now)s)
  AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(radius_m)s)
  AND (severity = 'critical'                 -- critical alerts bypass every preference
       OR (hazard_type = ANY(%(hazards)s)
           AND severity = ANY(%(severities)s)
           AND (%(include_marine)s OR NOT marine)))
ORDER BY array_position(ARRAY['critical','high','medium','low'], severity), first_reported_at DESC
LIMIT %(limit)s
"""


async def alerts_near(
    conn: AsyncConnection,
    lat: float,
    lon: float,
    radius_km: float,
    prefs: AlertPreferences = AlertPreferences(),
    *,
    now: datetime | None = None,
    min_tier: int = 0,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Active official events within radius_km of (lat, lon) that the user wants,
    most severe first. Uses the GiST index on events.location."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            ALERTS_NEAR_SQL,
            {
                "lat": lat,
                "lon": lon,
                "radius_m": radius_km * 1000,
                "hazards": sorted(prefs.hazard_types),
                "severities": prefs.allowed_severities(),
                "include_marine": prefs.include_marine,
                "now": now or datetime.now().astimezone(),
                "min_tier": min_tier,
                "limit": limit,
            },
        )
        return await cur.fetchall()


def filter_events(rows: Iterable[dict[str, Any]], prefs: AlertPreferences) -> list[dict[str, Any]]:
    """In-memory equivalent of the SQL filter, for delivery fan-out over a batch."""
    return [r for r in rows if prefs.matches(r["hazard_type"], r["severity"], r.get("marine", False))]
