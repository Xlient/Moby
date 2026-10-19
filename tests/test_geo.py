"""moby/geo.py must pick the same country as the app's countryAt (same outlines file)."""
import pytest

from moby.geo import country_at


@pytest.mark.parametrize("lat, lon, code", [
    (37.7749, -122.4194, "US"),     # San Francisco (the app's demo city)
    (27.6939, 86.7311, "NP"),       # Lukla, Nepal: the hiking scenario
    (14.5995, 120.9842, "PH"),      # Manila
    (35.6762, 139.6503, "JP"),      # Tokyo
    (22.3193, 114.1694, "HK"),      # Hong Kong: the small box, before China's outline
    (51.5074, -0.1278, None),       # London: not a covered country
    (0.0, -30.0, None),             # open ocean
])
def test_country_at(lat, lon, code):
    assert country_at(lat, lon) == code


def test_barrier_islands_off_the_simplified_coast():
    assert country_at(35.5225, -75.5246) == "US"          # Hatteras Island, ~20 km off the outline
