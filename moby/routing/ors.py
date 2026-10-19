"""OpenRouteService (openrouteservice.org): routes and place search, from OpenStreetMap.

Why ORS and not Google: Google's Routes API can only avoid tolls, highways, ferries and
indoor paths, never an area, and its terms don't allow showing its routes on a non-Google
map (Moby draws with MapLibre). ORS takes `avoid_polygons` and is open source, so Moby
can self-host it later. Free key: https://openrouteservice.org/dev/#/signup (ORS_API_KEY).

ORS decides how to get from A to B. Moby never does: it only checks the route against
the hazards it knows about (moby/routing/check.py) and asks ORS for one that avoids them.
"""
from dataclasses import dataclass
from typing import Any, Literal

import httpx

# api.openrouteservice.org was deprecated on 2026-04-28 for api.heigit.org (same keys).
# Directions live under /openrouteservice; place search (Pelias) moved to /pelias/v1.
ROUTING_BASE = "https://api.heigit.org/openrouteservice"
GEOCODE_BASE = "https://api.heigit.org/pelias/v1"
Profile = Literal["driving-car", "foot-hiking"]
TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class RoutingError(Exception):
    """ORS couldn't give a route. `reason` is a stable code the app shows copy for."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason


@dataclass
class Route:
    # GeoJSON LineString coordinates, [lon, lat].
    coordinates: list[list[float]]
    distance_m: float
    duration_s: float


# ORS error codes (https://giscience.github.io/openrouteservice/api-reference/error-codes).
# 2004: a request parameter exceeds a limit (avoid_polygons area, route length).
# 2009: no route between the points (e.g. everything around is avoided).
# 2010: a point is not near any road or path.
_ORS_REASONS = {2004: "over_limits", 2009: "no_route", 2010: "point_not_routable"}


def _reason(resp: httpx.Response) -> str:
    try:
        code = resp.json().get("error", {}).get("code")
    except ValueError:
        code = None
    if resp.status_code in (401, 403):
        return "not_configured"
    if resp.status_code == 429:
        return "rate_limited"
    return _ORS_REASONS.get(code, "routing_failed")


async def directions(
    client: httpx.AsyncClient,
    api_key: str,
    profile: Profile,
    origin: tuple[float, float],
    destination: tuple[float, float],
    avoid: dict[str, Any] | None = None,
) -> Route:
    """One route from origin to destination ((lat, lon) each), avoiding `avoid` (a GeoJSON
    MultiPolygon) when given. ORS treats avoid areas as hard: it fails rather than cross them."""
    body: dict[str, Any] = {
        "coordinates": [[origin[1], origin[0]], [destination[1], destination[0]]],
        "instructions": False,
        "elevation": False,
    }
    if avoid:
        body["options"] = {"avoid_polygons": avoid}
    try:
        resp = await client.post(
            f"{ROUTING_BASE}/v2/directions/{profile}/geojson",
            json=body,
            headers={"Authorization": api_key, "Accept": "application/geo+json"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise RoutingError("unreachable", str(e)) from e
    if resp.status_code != 200:
        raise RoutingError(_reason(resp), resp.text[:300])
    feature = resp.json()["features"][0]
    summary = feature["properties"].get("summary", {})
    return Route(
        coordinates=feature["geometry"]["coordinates"],
        distance_m=float(summary.get("distance", 0.0)),
        duration_s=float(summary.get("duration", 0.0)),
    )


async def search_places(
    client: httpx.AsyncClient, api_key: str, text: str, near: tuple[float, float] | None, size: int = 6,
) -> list[dict[str, Any]]:
    """Place search (Pelias), biased towards `near` ((lat, lon)) when given."""
    params: dict[str, Any] = {"text": text, "size": size}
    if near:
        params["focus.point.lat"], params["focus.point.lon"] = near
    try:
        resp = await client.get(
            f"{GEOCODE_BASE}/search", params=params, headers={"Authorization": api_key}, timeout=TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise RoutingError("unreachable", str(e)) from e
    if resp.status_code != 200:
        raise RoutingError(_reason(resp), resp.text[:300])
    places = []
    for f in resp.json().get("features", []):
        lon, lat = f["geometry"]["coordinates"][:2]
        props = f.get("properties", {})
        places.append({"label": props.get("label") or props.get("name") or f"{lat:.4f}, {lon:.4f}", "lat": lat, "lon": lon})
    return places
