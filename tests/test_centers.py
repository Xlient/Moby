"""Warning centres and EMSC (issue #8): PTWC tsunami, NHC/JTWC cyclones, EMSC quakes, quake dedupe."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest

from moby.feeds import centers, emsc
from moby.feeds.dedupe import merge_duplicate_quakes

from .test_chains_and_preferences import _test_db_url

FIX = Path(__file__).parent / "fixtures"


def test_ptwc_information_statement():
    atom = (FIX / "ptwc_atom.xml").read_text()
    issued = datetime(2026, 9, 27, 21, 56, 18, tzinfo=timezone.utc)
    r = centers.normalize_ptwc(atom, now=issued + timedelta(hours=1))
    (e,) = r.events
    assert e.source_feed == "ptwc" and e.hazard_type == "flood" and e.product == "Tsunami information"
    assert e.severity == "low" and e.external_id == "26270050"          # the event code: later bulletins update it
    assert e.magnitude == 5.2 and e.area_wkt.startswith("MULTIPOLYGON")
    assert e.expires_at == issued + timedelta(hours=6)
    # A day later the information statement has lapsed.
    assert centers.normalize_ptwc(atom, now=issued + timedelta(days=1)).skipped == {"expired": 1}


def test_ptwc_warning_is_critical():
    atom = (FIX / "ptwc_atom.xml").read_text().replace("Category:</strong> Information", "Category:</strong> Warning")
    (e,) = centers.normalize_ptwc(atom, now=datetime(2026, 9, 27, 22, tzinfo=timezone.utc)).events
    assert e.severity == "critical" and "within 1000 km" in e.description


def test_jtwc_super_typhoon():
    index = (FIX / "jtwc_index.rss").read_text()
    links = centers.jtwc_warning_links(index)
    assert "https://www.metoc.navy.mil/jtwc/products/wp2626web.txt" in links
    text = (FIX / "jtwc_wp2626.txt").read_text()
    now = datetime(2026, 10, 4, 16, 40, tzinfo=timezone.utc)
    issued = centers.jtwc_issued(text, now)
    assert issued == datetime(2026, 10, 4, 15, 0, tzinfo=timezone.utc)
    storm = centers.parse_jtwc_warning(text, issued)
    assert storm["kt"] == 135 and storm["id"] == "26W" and storm["warning"] == 19
    assert storm["track"][0][:2] == (23.3, 146.9) and len(storm["track"]) >= 3
    assert storm["track"][0][2] == pytest.approx(290 * 1.852)            # largest 34-kt radius
    r = centers.normalize_jtwc(index, {links[0]: text}, now=now)
    e = next(ev for ev in r.events if ev.external_id == "2026-26W")
    assert e.severity == "critical" and e.hazard_type == "storm" and e.expires_at == issued + timedelta(hours=9)
    assert r.skipped.get("fetch_failed", 0) == len(links) - 1


def test_cyclone_severity_scale():
    assert [centers.cyclone_severity(k) for k in (25, 40, 70, 100)] == ["low", "medium", "high", "critical"]


NHC_RSS = """<rss xmlns:nhc="https://www.nhc.noaa.gov"><channel><item>
  <title>Hurricane Rosa Advisory Number 12</title>
  <nhc:Cyclone><nhc:center>17.1, -104.2</nhc:center><nhc:type>HURRICANE</nhc:type><nhc:name>Rosa</nhc:name>
    <nhc:wallet>EP2</nhc:wallet><nhc:atcf>EP182026</nhc:atcf><nhc:datetime>9:00 AM MDT Sun Oct 4</nhc:datetime>
    <nhc:movement>NW at 9 mph</nhc:movement><nhc:pressure>970 mb</nhc:pressure><nhc:wind>110 mph</nhc:wind>
    <nhc:headline>ROSA STRENGTHENS OFF THE COAST OF MEXICO</nhc:headline></nhc:Cyclone>
</item></channel></rss>"""


def test_nhc_hurricane():
    (e,) = centers.normalize_nhc(NHC_RSS).events
    assert e.external_id == "EP182026" and e.severity == "high"         # 110 mph = category 2
    (major,) = centers.normalize_nhc(NHC_RSS.replace("110 mph", "115 mph")).events
    assert major.severity == "critical"                                 # 111+ mph = major (cat 3)
    assert e.title.startswith("Hurricane Rosa") and "approximate" in e.description
    assert centers.normalize_nhc("<rss><channel><item><title>None</title></item></channel></rss>").events == []


def test_hull_is_a_closed_ring_containing_the_circles():
    ring = centers.hull(centers.circle(10, 120, 100) + centers.circle(12, 121, 100))
    assert ring[0] == ring[-1] and len(ring) > 8


def test_emsc_normalize():
    r = emsc.normalize(json.loads((FIX / "emsc_events.json").read_text()))
    assert r.events and all(e.source_feed == "emsc" and e.magnitude >= 3.0 for e in r.events)
    assert all(e.title.startswith("M ") for e in r.events)
    assert "start=" in emsc.url_for_gap(timedelta(minutes=5))


# ── Same quake from two networks ─────────────────────────────────────

@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


def test_same_quake_from_usgs_and_emsc_is_one_event(db_url):
    t = datetime.now(timezone.utc) - timedelta(minutes=10)
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events CASCADE")

        def add(feed, ext, dt, lat, lon, mag, ingested):
            (eid,) = c.execute(
                "INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, location, "
                "first_reported_at, magnitude, ingested_at) VALUES ('official', %s, %s, 'earthquake', 'medium', 2, "
                "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s, %s, %s) RETURNING event_id",
                (feed, ext, lon, lat, dt, mag, ingested)).fetchone()
            return eid
        first = add("emsc", "e1", t, 38.40, 27.10, 4.8, t + timedelta(seconds=30))        # EMSC stored first
        dup = add("usgs", "u1", t + timedelta(seconds=8), 38.45, 27.20, 4.6, t + timedelta(seconds=90))
        other = add("usgs", "u2", t + timedelta(seconds=20), 38.42, 27.12, 3.1, t + timedelta(seconds=95))  # aftershock
        far = add("usgs", "u3", t, 36.0, 28.0, 4.8, t + timedelta(seconds=99))             # 300 km away

    async def run():
        async with await psycopg.AsyncConnection.connect(db_url, autocommit=True) as conn:
            return await merge_duplicate_quakes(conn)
    assert asyncio.run(run()) == 1
    with psycopg.connect(db_url) as c:
        rows = dict(c.execute("SELECT event_id, duplicate_of FROM events").fetchall())
    assert rows[dup] == first and rows[first] is None and rows[other] is None and rows[far] is None


def test_jtwc_skips_storms_nhc_covers():
    index = (FIX / "jtwc_index.rss").read_text()
    url = centers.jtwc_warning_links(index)[0]
    text = (FIX / "jtwc_wp2626.txt").read_text().replace("26W", "18E")
    r = centers.normalize_jtwc(index, {url: text}, now=datetime(2026, 10, 4, 16, 40, tzinfo=timezone.utc))
    assert not any(e.external_id.endswith("18E") for e in r.events) and r.skipped["nhc_basin"] == 1
