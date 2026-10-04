"""CAP feeds (migration 0009): parsing, area handling, chains, polling, area-aware proximity."""
import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool

from moby.alerts.preferences import alerts_near
from moby.feeds import cap
from moby.feeds.cap import CapSource, index_links, normalize_cap

from .test_chains_and_preferences import _test_db_url

SRC = CapSource("xx-test-en", "PH", "Test Weather Service", "https://alerts.example.gov/feed")
NOW = datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def cap_doc(identifier="A1", *, msg="Alert", status="Actual", severity="Severe", urgency="Immediate",
            event="Typhoon Warning", area="<polygon>14.0,121.0 14.0,121.2 14.2,121.2 14.2,121.0 14.0,121.0</polygon>",
            references="", sent=None, expires=None, extra_info="") -> str:
    sent = sent or NOW - timedelta(minutes=5)
    expires = expires or NOW + timedelta(hours=6)
    return f"""<?xml version="1.0"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>{identifier}</identifier><sender>test@example.gov</sender><sent>{iso(sent)}</sent>
  <status>{status}</status><msgType>{msg}</msgType><scope>Public</scope>
  {f'<references>{references}</references>' if references else ''}
  {extra_info}
  <info>
    <language>en-PH</language><category>Met</category><event>{event}</event>
    <urgency>{urgency}</urgency><severity>{severity}</severity><certainty>Likely</certainty>
    <expires>{iso(expires)}</expires>
    <headline>{event} for Manila</headline><description>Winds up to 120 km/h.</description>
    <instruction>Stay indoors.</instruction>
    <area><areaDesc>Metro Manila; Rizal</areaDesc>{area}</area>
  </info>
</alert>"""


# ── Parsing ──────────────────────────────────────────────────────────

def test_alert_with_polygon():
    e, outcome = normalize_cap(cap_doc(), SRC)
    assert outcome == "stored"
    assert e.external_id == "xx-test-en:A1" and e.source_feed == "cap" and e.region == "INTL" and e.country == "PH"
    assert e.hazard_type == "storm" and e.severity == "high" and not e.marine
    assert e.title == "Typhoon Warning for Manila" and "Stay indoors." in e.description
    assert e.area_wkt.startswith("MULTIPOLYGON(((121.00000 14.00000")      # lon lat order
    assert 14.0 < e.lat < 14.2 and 121.0 < e.lon < 121.2
    assert e.raw_payload["properties"]["authority"] == "Test Weather Service"
    assert e.raw_payload["properties"]["areaDesc"] == "Metro Manila; Rizal"


def test_circle_becomes_an_area():
    e, _ = normalize_cap(cap_doc(area="<circle>-8.34,115.51 10</circle>", event="Volcanic ash"), SRC)
    assert e.area_wkt and abs(e.lat - -8.34) < 0.01 and abs(e.lon - 115.51) < 0.01


@pytest.mark.parametrize(("kwargs", "reason"), [
    ({"status": "Exercise"}, "not_actual"),
    ({"msg": "Ack"}, "ack_or_error"),
    ({"expires": NOW - timedelta(minutes=1)}, "expired"),
    ({"urgency": "Past"}, "past"),
    ({"area": "<geocode><valueName>EMMA_ID</valueName><value>IT001</value></geocode>"}, "geocode_only"),
])
def test_skips(kwargs, reason):
    assert normalize_cap(cap_doc(**kwargs), SRC) == (None, reason)


def test_not_cap_and_not_xml():
    assert normalize_cap("<rss/>", SRC) == (None, "not_cap")
    assert normalize_cap("nope", SRC) == (None, "not_xml")


def test_cancel_and_final_update_end_the_referenced_alert():
    ref = "test@example.gov,A1,2026-10-04T00:00:00+00:00"
    e, outcome = normalize_cap(cap_doc("A2", msg="Cancel", references=ref, area=""), SRC)
    assert outcome == "cancel" and e.cancels and e.references == ["xx-test-en:A1"]
    e, outcome = normalize_cap(cap_doc("A3", msg="Update", urgency="Past", references=ref), SRC)
    assert outcome == "cancel"


def test_prefers_english_info_and_classifies_other_languages():
    spanish = """<info><language>es-MX</language><category>Met</category><event>Aviso de lluvias</event>
      <urgency>Expected</urgency><severity>Moderate</severity><certainty>Likely</certainty>
      <headline>Lluvias intensas</headline>
      <area><areaDesc>Oaxaca</areaDesc><polygon>16,-97 16,-96 17,-96 16,-97</polygon></area></info>"""
    e, _ = normalize_cap(cap_doc(extra_info=spanish), SRC)
    assert e.title == "Typhoon Warning for Manila"                  # the English block wins
    assert e.raw_payload["properties"]["languages"] == ["es-MX", "en-PH"]
    assert cap.classify("Aviso de lluvias", "Lluvias intensas", "Met") == "flood"
    assert cap.classify("Peringatan dini cuaca", "Hujan lebat disertai petir", "Met") == "flood"
    assert cap.classify("Strong Wind and Large Waves Advisory", "", "Met") == "storm"
    assert cap.classify("Heat", "Calor extremo", "Met") == "other"
    e, _ = normalize_cap(cap_doc(event="Strong Wind and Large Waves Advisory"), SRC)
    assert e.marine


def test_index_links_rss_atom_newest_first_and_ip_hosts():
    rss = """<rss><channel><link>https://alerts.example.gov</link>
      <item><link>https://alerts.example.gov/cap/old.xml</link><pubDate>Fri, 02 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><link>https://alerts.example.gov/cap/new.xml</link><pubDate>Sun, 04 Oct 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>"""
    assert index_links(rss) == ["https://alerts.example.gov/cap/new.xml", "https://alerts.example.gov/cap/old.xml"]
    atom = """<feed xmlns="http://www.w3.org/2005/Atom"><link href="https://publicalert.example.ph/feeds/"/>
      <entry><updated>2026-10-04T10:00:00Z</updated><link href="https://121.58.193.10/output/a.cap"/></entry></feed>"""
    assert index_links(atom, "https://publicalert.example.ph/feeds/") == ["https://publicalert.example.ph/output/a.cap"]


# ── Polling + proximity (DB) ─────────────────────────────────────────

@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


def poll(db_url, routes: dict[str, str]):
    def handler(request: httpx.Request) -> httpx.Response:
        body = routes.get(str(request.url))
        return httpx.Response(200, text=body) if body is not None else httpx.Response(404)

    async def go():
        async with AsyncConnectionPool(db_url, open=False) as pool, \
                httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await cap.poll_source(SRC, pool, http)
    return asyncio.run(go())


def feed(*urls):
    return "<rss><channel>" + "".join(f"<item><link>{u}</link></item>" for u in urls) + "</channel></rss>"


def test_poll_stores_chains_and_cancels(db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events, cap_documents CASCADE")
        c.execute("DELETE FROM feed_watermarks WHERE feed LIKE 'cap:%'")
    a1, a2, a3 = (f"https://alerts.example.gov/cap/{i}.xml" for i in ("a1", "a2", "a3"))
    ref = "test@example.gov,A1,2026-10-04T00:00:00+00:00"
    out = poll(db_url, {SRC.url: feed(a1), a1: cap_doc("A1")})
    assert (out.new_docs, out.upserted) == (1, 1)
    # An update (same chain) and then nothing new: each document is fetched once.
    out = poll(db_url, {SRC.url: feed(a1, a2), a2: cap_doc("A2", msg="Update", references=ref, severity="Extreme",
                                                         sent=NOW - timedelta(minutes=1))})
    assert out.new_docs == 1
    with psycopg.connect(db_url) as c:
        rows = c.execute("SELECT external_id, severity, country, area IS NOT NULL, feed_item_ids FROM events").fetchall()
    assert rows == [("xx-test-en:A1", "critical", "PH", True, ["xx-test-en:A1", "xx-test-en:A2"])]
    out = poll(db_url, {SRC.url: feed(a1, a2, a3), a3: cap_doc("A3", msg="Cancel", references=ref, area="")})
    assert out.cancelled == 1
    with psycopg.connect(db_url) as c:
        (expires,) = c.execute("SELECT expires_at FROM events").fetchone()
    assert expires <= datetime.now(timezone.utc)


def test_inside_a_large_area_counts_as_zero_distance(db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events, cap_documents CASCADE")
    big = "<polygon>10,120 10,126 18,126 18,120 10,120</polygon>"          # ~800 km box over Luzon/Visayas
    u = "https://alerts.example.gov/cap/big.xml"
    poll(db_url, {SRC.url: feed(u), u: cap_doc("BIG", area=big)})

    async def near(lat, lon, km):
        async with await psycopg.AsyncConnection.connect(db_url) as conn:
            return await alerts_near(conn, lat, lon, km)
    # Cebu City is inside the box but ~400 km from its centre.
    rows = asyncio.run(near(10.32, 123.89, 10))
    assert len(rows) == 1 and rows[0]["distance_km"] == 0 and rows[0]["country"] == "PH"
    assert asyncio.run(near(35.68, 139.69, 50)) == []                      # Tokyo: no


def test_alert_shape_for_cap_events():
    from moby.api.alerts import to_alert
    row = {"event_id": "e1", "source": "official", "source_feed": "cap", "severity": "critical", "tier": 2,
           "title": "Extreme rain warning. Ampurdán", "description": "x", "hazard_type": "flood",
           "first_reported_at": NOW, "lat": 42.1, "lon": 2.9, "product": "Aviso de lluvias", "marine": False,
           "raw_payload": {"properties": {"areaDesc": "Ampurdán", "authority": "AEMET (Spain)"}}, "distance_km": 0.0}
    a = to_alert(row)
    assert a["headline"] == "Extreme rain warning" and a["location_name"] == "Ampurdán"
    assert a["source_attribution"] == "AEMET (Spain)" and a["verification_label"] == "official_confirmed"
    assert a["distance_km"] == 0.0
