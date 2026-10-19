"""Hazard route check: does the way to somewhere cross a hazard Moby knows about?

POST /v1/routes/check  the usual route, the hazards it crosses, and one around them
GET  /v1/routes/places place search for the destination

Both go through OpenRouteService with the server's key (moby/routing/ors.py) and are
capped per day (moby/ai/budget.py). Only the two points and the search text leave for
ORS: no account, no device id. The answer never calls a route safe (moby/routing/check.py).
"""
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from moby.ai import budget
from moby.config import get_settings
from moby.routing import ors
from moby.routing.check import check_route

from .auth import Caller, require_user

router = APIRouter(prefix="/v1/routes", tags=["routes"])

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient()
    return _client


def _key() -> str:
    key = get_settings().ors_api_key
    if key is None:
        raise HTTPException(503, "routing_unavailable")
    return key.get_secret_value()


def _pool():
    from .app import _pool as app_pool  # late import: app.py owns the pool and imports this module
    return app_pool()


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteCheckIn(BaseModel):
    origin: Point
    destination: Point
    profile: Literal["driving-car", "foot-hiking"] = "driving-car"


# Reasons ORS gives that mean "your request", not "our service".
_CLIENT_REASONS = {"point_not_routable", "no_route", "over_limits"}


@router.post("/check")
async def route_check(body: RouteCheckIn, _caller: Annotated[Caller, Depends(require_user)]):
    key = _key()
    async with _pool().connection() as conn:
        if not await budget.take(conn, "route"):
            raise HTTPException(429, "daily_limit")
        try:
            return await check_route(
                conn, _http(), key, body.profile,
                (body.origin.lat, body.origin.lon), (body.destination.lat, body.destination.lon),
            )
        except ors.RoutingError as e:
            raise HTTPException(422 if e.reason in _CLIENT_REASONS else 502, e.reason) from e


@router.get("/places")
async def places(
    _caller: Annotated[Caller, Depends(require_user)],
    q: Annotated[str, Query(min_length=2, max_length=120)],
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
):
    key = _key()
    async with _pool().connection() as conn:
        if not await budget.take(conn, "places"):
            raise HTTPException(429, "daily_limit")
    near = (lat, lon) if lat is not None and lon is not None else None
    try:
        return {"places": await ors.search_places(_http(), key, q, near)}
    except ors.RoutingError as e:
        raise HTTPException(502, e.reason) from e
