"""Daily caps on paid calls, so cost stays bounded whatever the traffic (or a bug) does.

Each feature claims units before calling a model or Tavily; past the cap it degrades
the way it already does when a call fails:
  translate  the alert stays in its original language (translated the next day)
  explain    the app shows only the official text (explained the next day)
  ask        Ask Moby says it has reached today's limit; guidance still works offline
  tavily     Ask Moby answers from alerts and guidance only

Caps reset at 00:00 UTC. Override with MOBY_DAILY_CAP_<FEATURE> (e.g. MOBY_DAILY_CAP_ASK=200).
Defaults are sized for judging and a small user base: even if every cap is hit every
day, roughly $0.50 a day of Token Factory use (Nano ~$0.0003 per translation, Super
~$0.002 per explanation or answer), and Tavily stays inside its free 1,000 searches a
month. Explanations are cached per event, so 80 a day covers far more than 80 readers.
"""
import os
from datetime import datetime, timezone

from psycopg import AsyncConnection

DEFAULT_CAPS = {"translate": 800, "explain": 80, "ask": 60, "tavily": 25}


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


async def usage_today(conn: AsyncConnection) -> dict[str, str]:
    """{'ask': '12/300', ...} for /healthz."""
    rows = dict(await (await conn.execute(
        "SELECT feature, used FROM ai_usage WHERE day = %s", (_today(),))).fetchall())
    return {f: f"{rows.get(f, 0)}/{cap(f)}" for f in DEFAULT_CAPS}
