"""Daily caps on paid calls, so cost stays bounded whatever the traffic (or a bug) does.

Each feature claims units before calling a model or Tavily; past the cap it degrades
the way it already does when a call fails:
  translate  the alert stays in its original language (translated the next day)
  explain    the app shows only the official text (explained the next day)
  ask        Ask Moby says it has reached today's limit; guidance still works offline
  tavily     Ask Moby answers from alerts and guidance only
  localize   Moby's AI text stays in English (moby/ai/localize.py)
  structure  a report's note isn't read for details; the report is fused anyway (moby/graph)
  route      route checks answer 429 and the app says to try tomorrow (moby/api/routes.py)
  places     place search answers 429 the same way

Caps reset at 00:00 UTC. Override with MOBY_DAILY_CAP_<FEATURE> (e.g. MOBY_DAILY_CAP_ASK=200).
Defaults are sized for judging and a small user base: even if every cap is hit every
day, roughly $0.75 a day of Token Factory use (Nano ~$0.0003 per translation, Super
~$0.002 per explanation or answer), and Tavily stays inside its free 1,000 searches a
month. Route checks (up to 2 OpenRouteService directions calls each) and place searches
stay inside ORS's free daily quota (2,000 directions, 1,000 searches). Explanations are cached per event (and per language), so a cap covers far more
readers than its number; new warnings that are pushed get explained up front.
"""
import os
from datetime import datetime, timezone

from psycopg import AsyncConnection, Connection

DEFAULT_CAPS = {"translate": 800, "explain": 150, "ask": 60, "tavily": 25, "localize": 400, "structure": 300,
                "route": 400, "places": 500}


def cap(feature: str) -> int:
    return int(os.environ.get(f"MOBY_DAILY_CAP_{feature.upper()}", DEFAULT_CAPS[feature]))


def _today():
    return datetime.now(timezone.utc).date()


async def take(conn: AsyncConnection, feature: str, n: int = 1) -> int:
    """Claim up to n calls for today; returns how many were granted (0 = over the cap)."""
    if n <= 0:
        return 0
    limit, day = cap(feature), _today()
    async with conn.transaction():
        await conn.execute("INSERT INTO ai_usage (day, feature) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                           (day, feature))
        (used,) = await (await conn.execute(
            "SELECT used FROM ai_usage WHERE day = %s AND feature = %s FOR UPDATE", (day, feature))).fetchone()
        granted = max(0, min(n, limit - used))
        if granted:
            await conn.execute("UPDATE ai_usage SET used = used + %s WHERE day = %s AND feature = %s",
                               (granted, day, feature))
    return granted


def take_sync(conn: Connection, feature: str, n: int = 1) -> int:
    """`take` for synchronous code (the fusion graph's nodes). Same rules, same table."""
    if n <= 0:
        return 0
    limit, day = cap(feature), _today()
    with conn.transaction():
        conn.execute("INSERT INTO ai_usage (day, feature) VALUES (%s, %s) ON CONFLICT DO NOTHING", (day, feature))
        (used,) = conn.execute(
            "SELECT used FROM ai_usage WHERE day = %s AND feature = %s FOR UPDATE", (day, feature)).fetchone()
        granted = max(0, min(n, limit - used))
        if granted:
            conn.execute("UPDATE ai_usage SET used = used + %s WHERE day = %s AND feature = %s",
                         (granted, day, feature))
    return granted


async def usage_today(conn: AsyncConnection) -> dict[str, str]:
    """{'ask': '12/300', ...} for /healthz."""
    rows = dict(await (await conn.execute(
        "SELECT feature, used FROM ai_usage WHERE day = %s", (_today(),))).fetchall())
    return {f: f"{rows.get(f, 0)}/{cap(f)}" for f in DEFAULT_CAPS}
