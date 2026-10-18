"""Real-model check of the "Before you go" explanation (Nemotron Ultra on Token Factory).

    uv run --env-file .env python scripts/eval_trip_brief.py

Calls Ultra once per case (twice when a retry is needed) on fixed sources and prints what it
wrote, what the grounding checks kept and what they dropped. No database: the cap isn't
claimed, so it doesn't use today's `trip_brief` budget. CI never runs this.
"""
import asyncio
import sys
from contextlib import asynccontextmanager

from moby.ai import trip
from moby.ai.trip import Cited

FLOOD = Cited("O1", "official", "Flood warning for the Dudh Koshi",
              "Flood warning for the Dudh Koshi. Issued by Department of Hydrology and Meteorology.\n"
              "Hazard: flooding. Severity: high.\nArea: Dudh Koshi, Solukhumbu.\n"
              "The destination area overlaps the warning area.\n"
              "Text: The water level of the Dudh Koshi at Phakding has crossed the warning level and is rising "
              "after heavy rain upstream. People along the river banks and on trails close to the river should "
              "stay alert, keep away from the river and avoid crossing it until the level falls.")
BRIDGE = Cited("C1", "community", "Bridge washed out reported",
               "Bridge washed out reported. Reports from people nearby, not verified by any official source.\n"
               "Hazard: flooding. What people saw: a blocked road or path.\nSeverity people reported: high.\n"
               "Reported by 3 different people.\nLast report about 1 hours ago.\nAbout 1.0 km from the destination.")
QUAKE = Cited("O1", "official", "Magnitude 4.6 earthquake",
              "Magnitude 4.6 earthquake. Issued by U.S. Geological Survey.\nHazard: earthquake. Severity: medium.\n"
              "About 18 km from the destination.")

CASES = {
    "phakding": ("Phakding, Nepal, within 25 km, from 2026-10-20 to 2026-10-24", [FLOOD, BRIDGE]),
    "quake_only": ("Pokhara, Nepal, within 25 km, from 2026-10-20 to 2026-10-21", [QUAKE]),
}


class NoBudgetPool:
    """explain() claims the cap through the pool; here every claim is granted without a database."""
    @asynccontextmanager
    async def connection(self):
        yield None


async def main() -> int:
    async def take(_conn, _feature, n=1):
        return n
    trip.budget.take = take
    if trip._ultra() is None:
        print("N_FACTORY_ACC_KEY is not set", file=sys.stderr)
        return 1
    for name, (context, sources) in CASES.items():
        out, status = await trip.explain(NoBudgetPool(), context, sources)
        print(f"\n== {name}: {status}")
        for c in (out or {}).get("claims", []):
            print(f"  [{c['basis']}] {c['text']}  {c['cites']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
