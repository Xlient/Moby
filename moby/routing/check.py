"""Does a route cross a hazard Moby knows about? And is there one that goes around?

1. ORS gives the usual route (moby/routing/ors.py).
2. PostGIS finds the active hazards it touches: official warnings that have an area,
   and community reports (points, given a HAZARD_POINT_RADIUS_M circle).
3. If it touches any, ORS is asked again with those areas to avoid.
4. That route is checked the same way, because ORS doesn't always manage it.

What Moby never says: that a route is safe. It says a route crosses no hazard *Moby
knows about*, and the app says what that leaves out. No model is involved: the answer
is geometry against official and reported data.
"""
import json
from typing import Any

import httpx
from psycopg import AsyncConnection
from psycopg.rows import dict_row

from . import ors
from .ors import Profile, Route, RoutingError

# A community report is a point; treat it as this big a circle on the road.
HAZARD_POINT_RADIUS_M = 500
# Within this distance of a warning area counts as crossing it (GPS and simplification slack).
AREA_SLACK_M = 100
# ORS takes a limited avoid area; the largest warnings (whole counties) are left out of the
# avoid set and reported as "too large to route around".
MAX_AVOID_AREA_KM2 = 2_000
MAX_AVOID_POLYGONS = 20

# Same visibility as Home: official warnings, and community events from tier 1
# ("corroborated": 2+ people) up, never ones a reviewer rejected or that expired.
# Official alerts without an area (most quakes, storm centres) are points far from any
# road block, so only official *areas* count.
HAZARDS_ON_ROUTE_SQL = """
WITH route AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(%(route)s), 4326)::geography AS g),
start AS (SELECT ST_SetSRID(ST_MakePoint(%(o_lon)s, %(o_lat)s), 4326)::geography AS g),
finish AS (SELECT ST_SetSRID(ST_MakePoint(%(d_lon)s, %(d_lat)s), 4326)::geography AS g),
hazards AS (
  SELECT e.event_id, e.source, e.tier, e.hazard_type, e.severity, e.expires_at,
         COALESCE(e.alert_headline, e.title) AS headline,
         COALESCE(e.area, ST_Buffer(e.location, %(point_m)s)) AS shape
  FROM events e
  WHERE ((e.source = 'official' AND e.tier >= 2 AND e.area IS NOT NULL)
         OR (e.source <> 'official' AND e.tier >= 1))
    AND e.reviewer_decision IS DISTINCT FROM 'reject'
    AND e.duplicate_of IS NULL
    AND (e.expires_at IS NULL OR e.expires_at > now())
)
SELECT h.event_id, h.source, h.tier, h.hazard_type, h.severity, h.headline, h.expires_at,
       -- Where along the route it starts (0 = start, 1 = end), so the app can say "after 12 km".
       ST_LineLocatePoint(r.g::geometry, ST_ClosestPoint(r.g::geometry, h.shape::geometry)) AS at_fraction,
       -- The point on the route nearest the hazard: where the app puts its marker.
       ST_Y(ST_ClosestPoint(r.g::geometry, h.shape::geometry)) AS at_lat,
       ST_X(ST_ClosestPoint(r.g::geometry, h.shape::geometry)) AS at_lon,
       ST_Area(h.shape) / 1e6 AS area_km2,
       ST_Intersects(h.shape, s.g) AS contains_start,
       ST_Intersects(h.shape, f.g) AS contains_end,
       ST_AsGeoJSON(ST_SimplifyPreserveTopology(h.shape::geometry, 0.001), 5) AS shape_geojson
FROM hazards h, route r, start s, finish f
WHERE ST_DWithin(h.shape, r.g, %(slack_m)s)
ORDER BY at_fraction
"""

SEVERITY_ORDER = ["critical", "high", "medium", "low"]


def _line(route: Route) -> str:
    return json.dumps({"type": "LineString", "coordinates": route.coordinates})


async def hazards_on_route(
    conn: AsyncConnection, route: Route, origin: tuple[float, float], destination: tuple[float, float],
) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(HAZARDS_ON_ROUTE_SQL, {
            "route": _line(route), "point_m": HAZARD_POINT_RADIUS_M, "slack_m": AREA_SLACK_M,
            "o_lat": origin[0], "o_lon": origin[1], "d_lat": destination[0], "d_lon": destination[1],
        })
        return await cur.fetchall()


def avoid_set(hazards: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, list[str]]:
    """The MultiPolygon to send ORS, and the hazards that can't be avoided, with why.
    A hazard around the start or the end can't be avoided (you're in it, or going there),
    and a huge warning area is past what ORS accepts."""
    polygons: list[list] = []
    skipped: list[str] = []
    for h in sorted(hazards, key=lambda h: SEVERITY_ORDER.index(h["severity"])):
        eid = str(h["event_id"])
        if h["contains_start"] or h["contains_end"] or h["area_km2"] > MAX_AVOID_AREA_KM2:
            skipped.append(eid)
            continue
        shape = json.loads(h["shape_geojson"])
        parts = shape["coordinates"] if shape["type"] == "MultiPolygon" else [shape["coordinates"]]
        for p in parts:
            if len(polygons) < MAX_AVOID_POLYGONS:
                polygons.append(p)
            elif eid not in skipped:
                skipped.append(eid)
    return ({"type": "MultiPolygon", "coordinates": polygons} if polygons else None), skipped


def _hazard_out(h: dict[str, Any], route: Route, unavoidable: set[str]) -> dict[str, Any]:
    eid = str(h["event_id"])
    out = {
        "event_id": eid,
        # Same id the alert list uses, so the app can open the alert.
        "alert_id": eid,
        "hazard_type": h["hazard_type"],
        "severity": h["severity"],
        "verification": "official" if h["source"] == "official" else "community",
        "headline": h["headline"],
        "km_along": round(h["at_fraction"] * route.distance_m / 1000, 1),
        "at": {"lat": round(h["at_lat"], 5), "lon": round(h["at_lon"], 5)},
        "expires_at": h["expires_at"].isoformat() if h["expires_at"] else None,
    }
    if eid in unavoidable:
        out["cannot_avoid"] = (
            "start_inside" if h["contains_start"] else "end_inside" if h["contains_end"] else "too_large"
        )
    return out


def _route_out(route: Route, hazards: list[dict[str, Any]], unavoidable: set[str]) -> dict[str, Any]:
    return {
        "geometry": {"type": "LineString", "coordinates": route.coordinates},
        "distance_m": round(route.distance_m),
        "duration_s": round(route.duration_s),
        "hazards": [_hazard_out(h, route, unavoidable) for h in hazards],
    }


async def check_route(
    conn: AsyncConnection,
    client: httpx.AsyncClient,
    api_key: str,
    profile: Profile,
    origin: tuple[float, float],
    destination: tuple[float, float],
) -> dict[str, Any]:
    usual = await ors.directions(client, api_key, profile, origin, destination)
    crossed = await hazards_on_route(conn, usual, origin, destination)
    avoid, skipped = avoid_set(crossed)
    result: dict[str, Any] = {
        "profile": profile,
        "route": _route_out(usual, crossed, set(skipped)),
        "alternative": None,
        "alternative_problem": None,
    }
    if not crossed:
        return result
    if avoid is None:
        result["alternative_problem"] = "cannot_avoid"
        return result
    try:
        around = await ors.directions(client, api_key, profile, origin, destination, avoid=avoid)
    except RoutingError as e:
        result["alternative_problem"] = e.reason
        return result
    still = await hazards_on_route(conn, around, origin, destination)
    result["alternative"] = _route_out(around, still, set(skipped))
    return result
