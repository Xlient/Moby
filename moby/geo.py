"""Country for a position, offline, on the server: the same simplified country outlines the
app uses for emergency numbers (src/data/countryOutlines.json, Natural Earth, public domain),
so server and app always pick the same country. Coordinates never leave the machine: no
geocoding service is called (the country code is what goes into a web search).

Covers the countries Moby has official sources and emergency numbers for (US, JP, PH, NP,
…), plus Hong Kong and Macao. Approximate near borders (~10–15 km). Port of countryAt in
src/data/emergencyNumbers.ts: keep the two in step.
"""
import json
from functools import cache
from pathlib import Path

OUTLINES_FILE = Path(__file__).resolve().parents[1] / "src" / "data" / "countryOutlines.json"

# [lon_min, lat_min, lon_max, lat_max]: too small for the outlines, checked first.
SMALL = {"HK": (113.82, 22.15, 114.44, 22.57), "MO": (113.52, 22.1, 113.61, 22.22)}

# Simplified coastlines cut corners, so coastal places can fall just outside: look ~15 km around.
_NUDGE = 0.15
_AROUND = [(0, 0), (_NUDGE, 0), (-_NUDGE, 0), (0, _NUDGE), (0, -_NUDGE),
           (_NUDGE, _NUDGE), (_NUDGE, -_NUDGE), (-_NUDGE, _NUDGE), (-_NUDGE, -_NUDGE)]


@cache
def _outlines() -> dict[str, list[list[list[float]]]]:
    return json.loads(OUTLINES_FILE.read_text())["outlines"]


def _in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def country_at(lat: float, lon: float) -> str | None:
    """ISO country code for a position (e.g. "NP"), or None outside the covered countries."""
    for code, (x0, y0, x1, y1) in SMALL.items():
        if x0 <= lon <= x1 and y0 <= lat <= y1:
            return code
    for dy, dx in _AROUND:
        for code, rings in _outlines().items():
            if any(_in_ring(lon + dx, lat + dy, ring) for ring in rings):
                return code
    return None
