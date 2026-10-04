"""Boundaries for CAP area codes (issue #9).

MeteoAlarm EMMA_ID regions come from MeteoAlarm's published geocode file (the same
file their CAP profile refers to). Data © MeteoAlarm / EUMETNET members, used with
attribution (MeteoAlarm states CC BY 4.0 for its warning data).

    uv run python -m moby.feeds.geocodes            # (re)load
    uv run python -m moby.feeds.geocodes --if-empty # first start only (endpoint start.sh)
"""
import argparse
import asyncio
import json
import logging
import sys

import httpx
from psycopg import AsyncConnection

log = logging.getLogger("moby.feeds.geocodes")

METEOALARM_SOURCE = "MeteoAlarm geocodes 2026-07-31"
METEOALARM_URL = ("https://gitlab.com/meteoalarm-pm-group/documents/-/raw/master/"
                  "MeteoAlarm_Geocodes_2026_07_31.json")
SIMPLIFY_DEG = 0.005      # ~500 m: plenty for "is this phone in the warned region"

INSERT_SQL = """
INSERT INTO cap_geocodes (scheme, code, country, name, area, source)
VALUES (%(scheme)s, %(code)s, %(country)s, %(name)s,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(
            ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326), %(tol)s)), 3))::geography,
        %(source)s)
ON CONFLICT (scheme, code) DO UPDATE SET country = EXCLUDED.country, name = EXCLUDED.name,
    area = EXCLUDED.area, source = EXCLUDED.source, loaded_at = now()
"""


def rows_from_geojson(collection: dict, source: str) -> list[dict]:
    out = []
    for f in collection.get("features", []):
        p, g = f.get("properties") or {}, f.get("geometry")
        if not g or not p.get("code") or not p.get("type"):
            continue
        country = (p.get("country") or "").upper()
        out.append({"scheme": p["type"], "code": p["code"], "name": p.get("name"),
                    "country": country if len(country) == 2 else None,
                    "geom": json.dumps(g), "tol": SIMPLIFY_DEG, "source": source})
    return out


async def load(conn: AsyncConnection, collection: dict, source: str) -> int:
    rows = rows_from_geojson(collection, source)
    async with conn.cursor() as cur:
        await cur.executemany(INSERT_SQL, rows)
    return len(rows)


async def main_async(if_empty: bool) -> int:
    from moby.config import get_settings

    async with await AsyncConnection.connect(get_settings().database_url, autocommit=True) as conn:
        if if_empty:
            (n,) = await (await conn.execute("SELECT count(*) FROM cap_geocodes")).fetchone()
            if n:
                log.info("cap_geocodes already has %d rows; nothing to do", n)
                return 0
        log.info("downloading %s", METEOALARM_URL)
        async with httpx.AsyncClient(timeout=300, follow_redirects=True) as http:
            resp = await http.get(METEOALARM_URL)
            resp.raise_for_status()
        async with conn.transaction():
            n = await load(conn, resp.json(), METEOALARM_SOURCE)
            # Messages skipped for want of a boundary get another chance on the next poll.
            await conn.execute("DELETE FROM cap_documents WHERE detail = 'unknown_geocode'")
        log.info("loaded %d MeteoAlarm areas", n)
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description="Load boundaries for CAP area codes.")
    p.add_argument("--if-empty", action="store_true", help="only load when the table is empty")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    sys.exit(asyncio.run(main_async(args.if_empty)))


if __name__ == "__main__":
    main()


# ── China: county boundaries by adcode (lazy) ───────────────────────

# CMA CAP messages name areas by 'CPEAS Geographic Code' (12 digits); the first six are
# the county-level administrative code (adcode). Boundaries come from DataV GeoAtlas
# (Alibaba / AMap data), which publishes them in GCJ-02 — China's legally required,
# offset coordinate system — so they are converted to WGS84 before storing, keeping
# everything in Moby in one frame. Licence of the boundary data: to confirm (#20).
CN_SCHEME = "CPEAS Geographic Code"
CN_SOURCE = "DataV GeoAtlas (AMap), GCJ-02 converted to WGS84"
CN_URL = "https://geo.datav.aliyun.com/areas_v3/bound/{adcode}.json"

_A = 6378245.0
_EE = 0.00669342162296594323


def _out_of_china(lon: float, lat: float) -> bool:
    return not (72.004 <= lon <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _delta(lon: float, lat: float) -> tuple[float, float]:
    import math
    x, y = lon - 105.0, lat - 35.0
    dlat = (-100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
            + (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
            + (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
            + (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0)
    dlon = (300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
            + (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
            + (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
            + (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0)
    rad = lat / 180.0 * math.pi
    magic = 1 - _EE * math.sin(rad) ** 2
    sq = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sq) * math.pi)
    dlon = (dlon * 180.0) / (_A / sq * math.cos(rad) * math.pi)
    return dlon, dlat


def wgs84_to_gcj02(lon: float, lat: float) -> tuple[float, float]:
    if _out_of_china(lon, lat):
        return lon, lat
    dlon, dlat = _delta(lon, lat)
    return lon + dlon, lat + dlat


def gcj02_to_wgs84(lon: float, lat: float) -> tuple[float, float]:
    """Inverse by fixed-point iteration (sub-metre after a few steps)."""
    if _out_of_china(lon, lat):
        return lon, lat
    wlon, wlat = lon, lat
    for _ in range(5):
        glon, glat = wgs84_to_gcj02(wlon, wlat)
        wlon, wlat = wlon - (glon - lon), wlat - (glat - lat)
    return wlon, wlat


def _convert(coords):
    if coords and isinstance(coords[0], (int, float)):
        lon, lat = gcj02_to_wgs84(float(coords[0]), float(coords[1]))
        return [round(lon, 6), round(lat, 6)]
    return [_convert(c) for c in coords]


def cn_adcode(code: str) -> str | None:
    digits = "".join(ch for ch in code if ch.isdigit())
    return digits[:6] if len(digits) >= 6 else None


_cn_missing: set[str] = set()     # adcodes DataV doesn't have; don't ask again this process


async def ensure_cn_boundaries(conn: AsyncConnection, http: httpx.AsyncClient, adcodes: list[str],
                               limit: int = 120) -> set[str]:
    """Fetch and store boundaries for the adcodes we don't have yet (all of a poll's
    batch, a few at a time). Returns adcodes that failed on the network, so their
    messages are retried next poll instead of being recorded as unresolvable."""
    import asyncio

    wanted = sorted({a for a in adcodes if a and a not in _cn_missing})
    if not wanted:
        return set()
    have = {r[0] for r in await (await conn.execute(
        "SELECT code FROM cap_geocodes WHERE scheme = %s AND code = ANY(%s)", (CN_SCHEME, wanted))).fetchall()}
    todo = [a for a in wanted if a not in have]
    retry = set(todo[limit:])
    sem = asyncio.Semaphore(4)

    async def fetch(adcode: str):
        async with sem:
            try:
                return adcode, await http.get(CN_URL.format(adcode=adcode))
            except httpx.HTTPError:
                return adcode, None

    for adcode, r in await asyncio.gather(*(fetch(a) for a in todo[:limit])):
        if r is None or r.status_code >= 500:
            retry.add(adcode)              # network / server trouble: try again next poll
            continue
        feats = (r.json() or {}).get("features") or [] if r.status_code == 200 else []
        if not feats or not feats[0].get("geometry"):
            _cn_missing.add(adcode)        # DataV has no such area
            continue
        f = feats[0]
        geom = {**f["geometry"], "coordinates": _convert(f["geometry"]["coordinates"])}
        await conn.execute(INSERT_SQL, {"scheme": CN_SCHEME, "code": adcode, "country": "CN",
                                        "name": (f.get("properties") or {}).get("name"),
                                        "geom": json.dumps(geom), "tol": SIMPLIFY_DEG, "source": CN_SOURCE})
    return retry
