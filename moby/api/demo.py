"""Trying Moby away from a disaster: today's hot zones, and replays of real past alerts.

GET /v1/demo/hot-zones  places with the most going on right now, to view the app from
GET /v1/demo/replay     real past warnings, moved to a point and dated now, for demo mode

Judges (and anyone curious) are rarely standing in a flood. Hot zones are real, live
alerts: the app views one of them instead of the phone's position. Replays are real
alerts that have already happened, clearly marked `demo` with what they were and when;
nothing is written to the database, and nobody else ever sees them. Both are public and
read-only, like GET /v1/alerts.
"""
import math
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from moby.alerts.preferences import SEVERITY_ORDER

from .alerts import to_alert

router = APIRouter(prefix="/v1/demo", tags=["demo"])


def _pool():
    from .app import _pool as app_pool  # late import: app.py owns the pool and imports this module
    return app_pool()


# ── Hot zones ────────────────────────────────────────────────────────────────

# Zones are 1° cells (~110 km): about a region, and inside the app's 500 km fetch.
CELL_DEG = 1.0
HOT_ZONES_TTL_S = 600           # the list changes slowly; don't rescan events per request
_hot_cache: tuple[float, list[dict[str, Any]]] | None = None

# Active now, and new or updated today: what Home would show someone standing there.
# Marine products and single unconfirmed reports are left out (Home hides them by default).
HOT_EVENTS_SQL = """
SELECT event_id, hazard_type, severity, source,
       floor(ST_Y(location::geometry) / %(cell)s)::int AS cy,
       floor(ST_X(location::geometry) / %(cell)s)::int AS cx
FROM events
WHERE ((source = 'official' AND tier >= 2) OR (source <> 'official' AND tier >= 1))
  AND reviewer_decision IS DISTINCT FROM 'reject'
  AND duplicate_of IS NULL
  AND NOT marine
  AND (expires_at IS NULL OR expires_at > %(now)s)
  AND greatest(first_reported_at, last_updated_at) > %(since)s
"""


@dataclass
class Zone:
    cell: tuple[int, int]
    events: list[dict[str, Any]] = field(default_factory=list)

    @property
    def hazards(self) -> Counter:
        return Counter(e["hazard_type"] for e in self.events)

    def count(self, *severities: str) -> int:
        return sum(e["severity"] in severities for e in self.events)

    @property
    def score(self) -> float:
        """What makes a good place to try Moby: many kinds of hazard (each shows a different
        part of the app), serious warnings (emergency mode) and community reports, more
        than sheer volume, so 40 rain advisories don't beat a quake, a flood and a fire."""
        return (4 * len(self.hazards)
                + 3 * self.count("critical") + 2 * self.count("high")
                + 2 * min(sum(e["source"] != "official" for e in self.events), 3)
                + math.log2(1 + len(self.events)))

    @property
    def lead(self) -> dict[str, Any]:
        """The zone's most serious official alert (or report): the app centres on it, so
        someone viewing the zone is inside it and sees what Moby does with it."""
        return min(self.events, key=lambda e: (SEVERITY_ORDER[::-1].index(e["severity"]),
                                                e["source"] != "official"))


def rank_zones(events: list[dict[str, Any]], limit: int) -> list[Zone]:
    zones: dict[tuple[int, int], Zone] = {}
    for e in events:
        zones.setdefault((e["cy"], e["cx"]), Zone((e["cy"], e["cx"]))).events.append(e)
    return sorted(zones.values(), key=lambda z: z.score, reverse=True)[:limit]


async def _hot_zones(conn, now: datetime, limit: int) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(HOT_EVENTS_SQL, {"cell": CELL_DEG, "now": now, "since": now - timedelta(hours=24)})
        zones = rank_zones(await cur.fetchall(), limit)
        if not zones:
            return []
        from .app import EVENT_COLUMNS
        await cur.execute(f"SELECT {EVENT_COLUMNS} FROM events WHERE event_id = ANY(%s)",
                          ([z.lead["event_id"] for z in zones],))
        leads = {r["event_id"]: to_alert(r) for r in await cur.fetchall()}
    out = []
    for z in zones:
        lead = leads.get(z.lead["event_id"])
        if lead is None or "location" not in lead:
            continue
        out.append({
            "zone_id": f"{z.cell[0]}:{z.cell[1]}",
            "name": lead.get("location_name") or lead["headline"],
            "country": lead.get("country"),
            "center": {"lat": lead["location"]["lat"], "lon": lead["location"]["lon"]},
            "alert_count": len(z.events),
            "hazard_types": [h for h, _ in z.hazards.most_common()],
            "top_severity": z.lead["severity"],
            "has_community_reports": any(e["source"] != "official" for e in z.events),
            "lead_headline": lead["headline"],
        })
    return out


@router.get("/hot-zones")
async def hot_zones(limit: Annotated[int, Query(ge=1, le=20)] = 8):
    """Today's busiest places, best to try Moby from first. Each has a centre on its most
    serious alert: the app views from there (labelled, never treated as the phone's position)."""
    global _hot_cache
    now = time.monotonic()
    if _hot_cache is None or now - _hot_cache[0] > HOT_ZONES_TTL_S:
        async with _pool().connection() as conn:
            _hot_cache = (now, await _hot_zones(conn, datetime.now(timezone.utc), 20))
    return {"zones": _hot_cache[1][:limit], "generated_at": datetime.now(timezone.utc).isoformat()}


# ── Replay ───────────────────────────────────────────────────────────────────

# Past official warnings worth showing: serious, with agency text, explained when possible
# (so "What this means for you" appears), one per hazard type; plus one community event.
REPLAY_SQL = """
(SELECT DISTINCT ON (hazard_type) {cols}
 FROM events
 WHERE source = 'official' AND tier >= 2 AND severity IN ('high', 'critical')
   AND duplicate_of IS NULL AND NOT marine AND length(coalesce(description, '')) >= 40
   AND first_reported_at > %(since)s
 ORDER BY hazard_type, explainer_status = 'done' DESC, severity = 'critical' DESC, first_reported_at DESC)
UNION ALL
(SELECT {cols}
 FROM events
 WHERE source <> 'official' AND tier >= 1 AND reviewer_decision IS DISTINCT FROM 'reject'
   AND first_reported_at > %(since)s
 ORDER BY distinct_reporter_count DESC, first_reported_at DESC
 LIMIT 1)
"""
REPLAY_MAX = 5


def _offset(lat: float, lon: float, km: float, bearing_deg: float) -> tuple[float, float]:
    b = math.radians(bearing_deg)
    dlat = km * math.cos(b) / 111.32
    dlon = km * math.sin(b) / (111.32 * max(math.cos(math.radians(lat)), 0.01))
    return round(lat + dlat, 5), round(((lon + dlon + 180) % 360) - 180, 5)


def replay_alerts(rows: list[dict[str, Any]], lat: float, lon: float, now: datetime) -> list[dict[str, Any]]:
    """Real past alerts placed around (lat, lon) and dated now. The most serious official one
    is right on the point (distance 0), so the person is inside it: that's what opens
    emergency mode. The rest sit a few km away. Each says what it really was."""
    rows = sorted(rows, key=lambda r: (r["source"] != "official", SEVERITY_ORDER[::-1].index(r["severity"])))
    out = []
    for i, r in enumerate(rows[:REPLAY_MAX]):
        real = to_alert({**r, "distance_km": None})
        km = 0.0 if i == 0 else 2.5 * i + 1
        a_lat, a_lon = _offset(lat, lon, km, 70 * i) if km else (lat, lon)
        real.pop("country", None)              # emergency numbers: where the person is, not where it was
        out.append({
            **{k: v for k, v in real.items() if k != "location_name"},
            "alert_id": f"demo-{r['event_id']}",
            "location": {"lat": a_lat, "lon": a_lon, "frame": "WGS84"},
            "distance_km": km,
            "issued_at": (now - timedelta(minutes=6 + 9 * i)).isoformat(),
            "expires_at": (now + timedelta(hours=3)).isoformat(),
            "demo": True,
            "replay_of": {"issued_at": real["issued_at"], "location_name": real.get("location_name")},
        })
    return out


@router.get("/replay")
async def replay(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
):
    """Demo mode: up to five real past alerts around (lat, lon). Never stored, never pushed,
    never in anyone's GET /v1/alerts; event_id is the real event, so its explanation and
    brief still open."""
    from .app import EVENT_COLUMNS
    now = datetime.now(timezone.utc)
    async with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(REPLAY_SQL.format(cols=EVENT_COLUMNS), {"since": now - timedelta(days=180)})
        rows = await cur.fetchall()
    return {"alerts": replay_alerts(rows, lat, lon, now)}

