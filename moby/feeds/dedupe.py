"""Merge the same earthquake reported by several networks (issue #8).

USGS, EMSC (and later JMA) each publish the same quake with slightly different
times, positions and magnitudes. The copy stored first stays the event; later
copies get `duplicate_of` and are never listed or pushed. Deterministic on purpose:
two quakes within a minute and 50 km with similar magnitudes are the same quake.
"""
from psycopg import AsyncConnection

MATCH_SQL = """
UPDATE events AS n SET duplicate_of = o.event_id
FROM events AS o
WHERE n.hazard_type = 'earthquake' AND o.hazard_type = 'earthquake'
  AND n.source = 'official' AND o.source = 'official'
  AND n.duplicate_of IS NULL AND o.duplicate_of IS NULL
  AND n.source_feed <> o.source_feed
  AND n.first_reported_at > now() - interval '7 days'
  -- the earlier-stored copy wins (ties: lowest id), so the event users saw first stays
  AND (o.ingested_at, o.event_id) < (n.ingested_at, n.event_id)
  AND o.first_reported_at BETWEEN n.first_reported_at - interval '60 seconds'
                              AND n.first_reported_at + interval '60 seconds'
  AND ST_DWithin(o.location, n.location, 50000)
  AND (n.magnitude IS NULL OR o.magnitude IS NULL OR abs(n.magnitude - o.magnitude) <= 0.6)
"""


async def merge_duplicate_quakes(conn: AsyncConnection) -> int:
    cur = await conn.execute(MATCH_SQL)
    return cur.rowcount
