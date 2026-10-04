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
