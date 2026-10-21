"""'Before you go' (moby/ai/trip.py): PostGIS picks the rows, Ultra only explains them.

Pure checks always run; the spatial query, cache, caps and route use the throwaway
`moby_test` database and a fake model (CI never calls a model).
"""
import asyncio
import json
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.ai import trip
from moby.ai.trip import Cited, Stop, TripClaim, TripExplanation
from moby.config import get_settings

from .test_chains_and_preferences import _test_db_url

NOW = datetime.now(timezone.utc).replace(microsecond=0)
TODAY = NOW.date()
PHAKDING = (27.74, 86.71)

FLOOD = Cited("O1", "official", "Flood warning",
              "Flood warning. Issued by Department of Hydrology and Meteorology.\nHazard: flooding. Severity: high.\n"
              "Area: Dudh Koshi.\nThe destination area overlaps the warning area.\n"
              "Text: The Dudh Koshi river is expected to rise above the danger level of 4.5 m. Avoid river banks "
              "and low trail sections.")
BRIDGE = Cited("C1", "community", "Bridge washed out reported",
               "Bridge washed out reported. Reports from people nearby, not verified by any official source.\n"
               "Hazard: flooding. What people saw: a blocked road or path.\nSeverity people reported: high.\n"
               "Reported by 3 different people.\nLast report about 2 hours ago.\nAbout 1.2 km from the destination.")
CONTEXT = "Phakding, Nepal, within 25 km, from 2026-10-18 to 2026-10-21"
SOURCES = {s.id: s for s in (FLOOD, BRIDGE)}


def claim(text, *cites):
    return TripClaim(text=text, cites=list(cites))


# ── Grounding: every statement must be backed by what it cites ──────────────

def test_grounded_claims_pass_and_get_their_basis_from_their_citations():
    ok, problem = trip.check_claim(claim("The Dudh Koshi river is expected to rise above the danger level of "
                                         "4.5 m, so avoid river banks and low trail sections near Phakding.", "O1"),
                                   SOURCES, CONTEXT)
    assert problem is None and ok["basis"] == "official" and ok["cites"] == ["O1"]
    ok, problem = trip.check_claim(claim("3 people nearby report the bridge washed out; it isn't confirmed. "
                                         "[C1]"), SOURCES, CONTEXT)
    assert problem is None and ok["basis"] == "community" and ok["cites"] == ["C1"]
    assert "[C1]" not in ok["text"]


def test_claims_that_add_numbers_places_or_hazards_are_dropped():
    def why(text, *cites):
        return trip.check_claim(claim(text, *cites), SOURCES, CONTEXT)[1]

    assert "numbers" in why("The river is expected to rise above 6 m; avoid river banks.", "O1")
    assert "numbers" in why("Five people nearby report the bridge washed out.", "C1")      # spelled out
    assert "names" in why("The river is expected to rise near Namche Bazaar; avoid river banks.", "O1")
    assert "hazards" in why("The river is expected to rise and landslides may block low trail sections.", "O1")
    assert "strays" in why("Bring a passport, travel insurance and extra cash for porters and lodges.", "O1")
    assert "no valid citation" in why("Avoid river banks and low trail sections.", "O9")
    # The number is in O1, but only C1 is cited.
    assert "numbers" in why("The river may rise above the danger level of 4.5 m.", "C1")


def test_short_sources_allow_framing_words_but_not_new_hazards():
    # Real Ultra output on a two-line quake alert (scripts/eval_trip_brief.py).
    quake = Cited("O1", "official", "Magnitude 4.6 earthquake",
                  "Magnitude 4.6 earthquake. Issued by U.S. Geological Survey.\nHazard: earthquake. Severity: medium.\n"
                  "About 18 km from the destination.")
    ctx = "Pokhara, Nepal, within 25 km, from 2026-10-20 to 2026-10-21"
    ok, problem = trip.check_claim(claim("An official alert reports a magnitude 4.6 earthquake about 18 km from "
                                         "Pokhara, rated medium severity, close to the travel area.", "O1"),
                                   {"O1": quake}, ctx)
    assert problem is None, problem
    problem = trip.check_claim(claim("An official alert reports a magnitude 4.6 earthquake about 18 km from "
                                     "Pokhara, which could cause aftershocks during your stay.", "O1"),
                               {"O1": quake}, ctx)[1]
    assert "hazards" in problem


def test_real_ultra_bridge_statement_passes():
    # Ultra on the seeded Phakding demo (2026-10-19): accurate, but dropped before "roughly"/"unverified" were framing.
    ok, problem = trip.check_claim(claim("People nearby report that a bridge has been washed out roughly 1.2 km from "
                                         "Phakding, which may block trails or crossing points; this information is "
                                         "unverified.", "C1"), SOURCES, CONTEXT)
    assert problem is None and ok["basis"] == "community", problem


def test_month_names_are_dates_and_hazards_match_by_stem():
    # Real Ultra statements (2026-10-19) that were wrongly dropped: "October" as an unknown name,
    # "flood" not matching "flooding".
    flood = Cited("O1", "official", "Flood warning for the Dudh Koshi",
                  "Flood warning for the Dudh Koshi.\nExpires 2026-10-21 09:03 UTC.\nText: The water level has crossed "
                  "the warning level and is rising. Keep away from the river banks and avoid crossing the river.")
    srcs = {"O1": flood, "C1": BRIDGE}
    ok, problem = trip.check_claim(claim("An official flood warning for the Dudh Koshi is in effect until 21 October "
                                         "09:03 UTC; keep away from the river banks and avoid crossing the river.",
                                         "O1"), srcs, CONTEXT)
    assert problem is None, problem
    assert "numbers" in trip.check_claim(claim("An official flood warning for the Dudh Koshi is in effect until 21 "
                                               "November; keep away from the river banks.", "O1"), srcs, CONTEXT)[1]
    ok, problem = trip.check_claim(claim("The flood warning is in effect through the morning of Oct 21; keep away "
                                         "from the river banks.", "O1"), srcs, CONTEXT)
    assert problem is None, problem
    ok, problem = trip.check_claim(claim("People nearby report a bridge washed out by the flood, about 1.2 km from "
                                         "Phakding; this is unverified.", "C1"), srcs, CONTEXT)
    assert problem is None, problem


def test_disclaiming_official_status_is_not_claiming_it():
    # Real Ultra statement (2026-10-19), dropped 3 times in 6 runs before negated clauses were ignored.
    ok, problem = trip.check_claim(claim("People nearby report a bridge washed out about 1.2 km from Phakding, blocking "
                                         "a road or path; this is unverified and not confirmed by any official source.",
                                         "C1"), SOURCES, CONTEXT)
    assert problem is None and ok["basis"] == "community", problem
    problem = trip.check_claim(claim("Authorities confirmed the bridge washed out about 1.2 km from Phakding; people nearby "
                                     "report it is not passable.", "C1"),
                               SOURCES, CONTEXT)[1]
    assert "presented as official" in problem


def test_community_reports_are_never_presented_as_official():
    problem = trip.check_claim(claim("Officials confirmed the bridge washed out.", "C1"), SOURCES, CONTEXT)[1]
    assert "presented as official" in problem
    ok, problem = trip.check_claim(claim("People nearby report the bridge washed out, not confirmed by officials.",
                                         "C1"), SOURCES, CONTEXT)
    assert problem is None and ok["basis"] == "community"


def test_uncertainty_is_never_empty_and_says_the_pack_goes_stale():
    notes = trip.uncertainty(generated_at=NOW, radius_km=25, start=TODAY, official=[], community=[],
                             ai_status="nothing_to_explain", web_status="searched", today=TODAY)
    assert notes and any("stale" in n and "after it was saved" in n for n in notes)
    assert any("doesn't mean it's safe" in n for n in notes)
    over = trip.uncertainty(generated_at=NOW, radius_km=25, start=TODAY + timedelta(days=2), official=[1],
                            community=[1], ai_status="over_cap", web_status="no_key", today=TODAY)
    assert any("wasn't written by AI" in n for n in over) and any("starts in 2 days" in n for n in over)
    assert any("unverified" in n for n in over) and any("weren't searched" in n for n in over)


def test_every_country_with_official_sites_has_a_name():
    from moby.search.official import OFFICIAL
    assert set(OFFICIAL) <= set(trip.COUNTRY_NAMES)


def test_no_hazards_no_web_search(monkeypatch):
    """Nothing found there: a search for "natural hazard warning China" only finds unrelated pages."""
    import moby.search.tavily as tavily

    monkeypatch.setattr(tavily, "Tavily", lambda **_: pytest.fail("searched with no hazard to search for"))
    web, status = asyncio.run(trip.web_sources(None, [], None, "CN"))
    assert (web, status) == ([], "nothing_to_search")
    assert "didn't search" in trip.WEB_NOTES["nothing_to_search"]


def test_search_query_uses_structured_fields_only():
    assert trip.search_query(["flood", "landslide"], "Phakding", "NP") == \
        "flooding landslide warning travel safety Phakding Nepal"
    # Anything that doesn't look like a place name is left out of the query.
    assert "@" not in trip.search_query([], "call me +977 98 @ lodge", "NP")


def test_the_same_page_is_cited_once():
    from moby.search.tavily import SearchResult

    pages = [SearchResult("Risk profile", "http://drrportal.gov.np/risk-profile-of-nepal", "Flood is common.", 0.4),
             SearchResult("Risk profile", "http://www.drrportal.gov.np/risk-profile-of-nepal/", "Flood is common.", 0.4),
             SearchResult("Empty", "https://bipad.gov.np/x", "", 0.3)]
    assert [r.url for r in trip.unique_pages(pages)] == ["http://drrportal.gov.np/risk-profile-of-nepal"]


def test_rate_limit_per_user_per_hour():
    trip._asked.clear()
    assert all(trip.allow("u1", now=float(i)) for i in range(trip.RATE_LIMIT))
    assert not trip.allow("u1", now=10.0)
    assert trip.allow("u2", now=10.0) and trip.allow("u1", now=3700.0)


# ── explain(): fake Ultra, one retry at most ────────────────────────────────

class FakeUltra:
    def __init__(self, *outputs):
        self.outputs, self.calls = list(outputs), []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        out = self.outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


class FakePool:
    @asynccontextmanager
    async def connection(self):
        yield None


GOOD = claim("The Dudh Koshi river is expected to rise above the danger level; avoid river banks and low trail "
             "sections.", "O1")
BAD = claim("A glacial lake outburst is likely within 2 days.", "O1")


def wire(monkeypatch, ultra, granted=10):
    monkeypatch.setattr(trip, "_ultra", lambda: (ultra, "nemotron-3-ultra"))
    left = {"n": granted}

    async def take(_conn, feature, n=1):
        assert feature == "trip_brief"
        if left["n"] <= 0:
            return 0
        left["n"] -= 1
        return 1
    monkeypatch.setattr(trip.budget, "take", take)


def test_explain_drops_failing_claims_and_retries_once(monkeypatch):
    ultra = FakeUltra(TripExplanation(reasoning="", claims=[BAD, BAD]),
                      TripExplanation(reasoning="", claims=[GOOD, BAD]))
    wire(monkeypatch, ultra)
    out, status = asyncio.run(trip.explain(FakePool(), CONTEXT, [FLOOD, BRIDGE]))
    assert status == "partial" and [c["cites"] for c in out["claims"]] == [["O1"]]
    assert len(ultra.calls) == 2 and "rejected" in ultra.calls[1][1][1]   # the retry says what was wrong


def test_explain_withholds_when_nothing_survives_and_never_retries_twice(monkeypatch):
    ultra = FakeUltra(TripExplanation(reasoning="", claims=[BAD]), RuntimeError("timeout"))
    wire(monkeypatch, ultra)
    assert asyncio.run(trip.explain(FakePool(), CONTEXT, [FLOOD])) == (None, "withheld")
    assert len(ultra.calls) == 2


def test_explain_over_the_cap_makes_no_model_call(monkeypatch):
    ultra = FakeUltra()
    wire(monkeypatch, ultra, granted=0)
    assert asyncio.run(trip.explain(FakePool(), CONTEXT, [FLOOD])) == (None, "over_cap")
    assert ultra.calls == []


def test_explain_accepts_a_clean_first_answer_without_retrying(monkeypatch):
    ultra = FakeUltra({"reasoning": "", "claims": [GOOD.model_dump()]})
    wire(monkeypatch, ultra)
    out, status = asyncio.run(trip.explain(FakePool(), CONTEXT, [FLOOD]))
    assert status == "ok" and len(out["claims"]) == 1 and len(ultra.calls) == 1


# ── Database: the spatial query, cache and cap fallback ─────────────────────

@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


def seed(url):
    """Around Phakding: what must and must not be in a 25 km briefing."""
    lat, lon = PHAKDING
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("TRUNCATE events, trip_brief_cache, ai_usage CASCADE")

        def official(ext, dlat, dlon, *, area_km=None, expires=NOW + timedelta(days=1), severity="high",
                     updated=NOW, hazard="flood"):
            c.execute(
                """INSERT INTO events (source, source_feed, external_id, region, hazard_type, severity, tier, title,
                                       description, location, area, country, expires_at, last_updated_at,
                                       first_reported_at)
                   VALUES ('official', 'cap', %(ext)s, 'INTL', %(hazard)s, %(sev)s, 2, %(ext)s,
                           'The Dudh Koshi river is expected to rise. Avoid river banks.',
                           ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
                           CASE WHEN %(area)s::float IS NULL THEN NULL ELSE ST_Multi(ST_Buffer(
                               ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(area)s * 1000
                           )::geometry)::geography END,
                           'NP', %(exp)s, %(upd)s, %(upd)s)""",
                {"ext": ext, "lat": lat + dlat, "lon": lon + dlon, "area": area_km, "exp": expires, "upd": updated,
                 "sev": severity, "hazard": hazard})

        def community(name, dlat, dlon, *, people=3, updated=NOW, decision=None):
            c.execute(
                """INSERT INTO events (source, region, hazard_type, observed_effect, severity, tier, alert_headline,
                                       location, distinct_reporter_count, last_updated_at, reviewer_decision)
                   VALUES ('manual', 'INTL', 'flood', 'blocked_road', 'high', 1, %s,
                           ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s, %s, %s)""",
                (name, lon + dlon, lat + dlat, people, updated, decision))

        # 0.36° ≈ 40 km north: the point is outside 25 km, but its 45 km area covers the destination.
        official("area-reaches", 0.36, 0, area_km=45, severity="critical")
        official("point-near", 0.05, 0)                              # ~5.5 km
        official("area-edge", -0.40, 0, area_km=25)                  # ~44 km away, its area to ~19 km: intersects
        official("area-short", -0.60, 0, area_km=25)                 # ~67 km away, its area to ~42 km: doesn't
        official("point-far", 0.30, 0)                               # ~33 km: outside
        official("expired", 0.02, 0, expires=NOW - timedelta(hours=1))
        official("quake-no-expiry-old", 0.02, 0, expires=None, updated=NOW - timedelta(days=3), hazard="earthquake")
        community("Bridge washed out reported", 0.01, 0)
        community("Old report", 0.01, 0, updated=NOW - timedelta(days=5))
        community("Rejected report", 0.01, 0, decision="reject")
        community("Far report", 0.4, 0)


def test_spatial_query_picks_rows_by_area_and_distance(db_url):
    seed(db_url)

    async def go():
        async with await psycopg.AsyncConnection.connect(db_url) as conn:
            return (await trip.official_near(conn, [Stop(*PHAKDING)], 25, NOW),
                    await trip.community_near(conn, [Stop(*PHAKDING)], 25, NOW))
    official, community = asyncio.run(go())
    assert [r["external_id"] for r in official] == ["area-reaches", "point-near", "area-edge"]   # critical first
    assert official[0]["distance_km"] == pytest.approx(0, abs=0.1)                 # inside the area
    assert official[2]["distance_km"] == pytest.approx(19.5, abs=1.5)              # to the area's edge
    assert [r["alert_headline"] for r in community] == ["Bridge washed out reported"]


# A route east-west through Phakding: its ends are ~49 km away, but the line passes the rows.
WEST, EAST = Stop(PHAKDING[0], PHAKDING[1] - 0.5, "West"), Stop(PHAKDING[0], PHAKDING[1] + 0.5, "East")
ROUTE = [WEST, Stop(*PHAKDING, "Phakding"), EAST]


def test_a_route_is_checked_along_the_line_not_just_at_its_stops(db_url):
    seed(db_url)

    async def go(stops):
        async with await psycopg.AsyncConnection.connect(db_url) as conn:
            return (await trip.official_near(conn, stops, 10, NOW), await trip.community_near(conn, stops, 10, NOW))
    official, community = asyncio.run(go(ROUTE))
    # point-near is ~5.5 km off the line; area-reaches covers it; point-far (~33 km) and area-edge (~19 km) don't.
    assert [r["external_id"] for r in official] == ["area-reaches", "point-near"]
    assert official[0]["distance_km"] == pytest.approx(0, abs=0.1)
    assert official[1]["near_stop"] == "Phakding" and community[0]["near_stop"] == "Phakding"
    assert [r["alert_headline"] for r in community] == ["Bridge washed out reported"]
    # A warning area covering several stops is 'near' the stop closest to its centre, not the first one.
    async def covering():
        async with await psycopg.AsyncConnection.connect(db_url) as conn:
            near_centre = Stop(PHAKDING[0] + 0.36, PHAKDING[1], "Centre")
            return await trip.official_near(conn, [Stop(*PHAKDING, "Phakding"), near_centre], 10, NOW)
    rows = {r["external_id"]: r["near_stop"] for r in asyncio.run(covering())}
    assert rows["area-reaches"] == "Centre"       # its area covers both stops; its centre is at "Centre"
    # The same ends checked as points find nothing: the line is what matters.
    for end in (WEST, EAST):
        assert asyncio.run(go([end])) == ([], [])


def test_route_geometry_and_length():
    assert trip.trip_wkt([Stop(27.74, 86.71)]) == "SRID=4326;POINT(86.71 27.74)"
    assert trip.trip_wkt(ROUTE[:2]).startswith("SRID=4326;LINESTRING(86.21 27.74, 86.71 27.74")
    assert trip.route_length_km([WEST, EAST]) == pytest.approx(98.4, abs=1)
    assert trip.snapped([Stop(27.7398, 86.713, " Phakding ")]) == [Stop(27.74, 86.71, "Phakding")]


class Pool:
    def __init__(self, url):
        self.url = url

    @asynccontextmanager
    async def connection(self):
        async with await psycopg.AsyncConnection.connect(self.url, autocommit=True) as conn:
            yield conn


def no_web(monkeypatch):
    async def web(_pool, _hazards, _place, _country):
        return [], "no_key"
    monkeypatch.setattr(trip, "web_sources", web)


def test_brief_over_the_cap_returns_the_plain_list_labelled(db_url, monkeypatch):
    seed(db_url)
    no_web(monkeypatch)
    monkeypatch.setenv("MOBY_DAILY_CAP_TRIP_BRIEF", "0")
    ultra = FakeUltra()
    monkeypatch.setattr(trip, "_ultra", lambda: (ultra, "ultra"))
    out = asyncio.run(trip.brief(Pool(db_url), lat=PHAKDING[0] + 0.001, lon=PHAKDING[1], radius_km=25, start=TODAY,
                                 end=TODAY + timedelta(days=3), place_name="Phakding"))
    assert ultra.calls == [] and out["ai_status"] == "over_cap" and "explanation" not in out
    assert [a["cite_id"] for a in out["official_alerts"]] == ["O1", "O2", "O3"]
    assert out["community_reports"][0]["verification_label"] != "official_confirmed"
    assert out["community_reports"][0]["reporter_count"] == 3
    assert out["destination"]["lat"] == 27.74 and out["destination"]["country"] == "NP"   # snapped, from the alerts
    assert any("wasn't written by AI" in n for n in out["uncertainty"])
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT count(*) FROM trip_brief_cache").fetchone()[0] == 0   # not cached


def test_brief_is_cached_until_an_alert_changes(db_url, monkeypatch):
    seed(db_url)
    no_web(monkeypatch)
    good = claim("The Dudh Koshi river is expected to rise. Avoid river banks.", "O1")
    ultra = FakeUltra(*[TripExplanation(reasoning="", claims=[good]) for _ in range(3)])
    monkeypatch.setattr(trip, "_ultra", lambda: (ultra, "ultra"))
    kw = dict(lat=PHAKDING[0], lon=PHAKDING[1], radius_km=25, start=TODAY, end=TODAY + timedelta(days=3))
    first = asyncio.run(trip.brief(Pool(db_url), **kw))
    second = asyncio.run(trip.brief(Pool(db_url), **kw))
    assert first["ai_status"] == "ok" and not first["cached"] and second["cached"]
    assert second["explanation"] == first["explanation"] and len(ultra.calls) == 1
    with psycopg.connect(db_url, autocommit=True) as c:
        row = c.execute("SELECT payload::text, lat, lon FROM trip_brief_cache").fetchone()
        assert (row[1], row[2]) == pytest.approx(PHAKDING)          # only the snapped point is kept
        c.execute("UPDATE events SET last_updated_at = now() WHERE external_id = 'point-near'")
    third = asyncio.run(trip.brief(Pool(db_url), **kw))
    assert not third["cached"] and len(ultra.calls) == 2


def test_nothing_found_means_no_model_call(db_url, monkeypatch):
    seed(db_url)
    no_web(monkeypatch)
    ultra = FakeUltra()
    monkeypatch.setattr(trip, "_ultra", lambda: (ultra, "ultra"))
    out = asyncio.run(trip.brief(Pool(db_url), lat=-45.0, lon=170.0, radius_km=25, start=TODAY, end=TODAY))
    assert out["ai_status"] == "nothing_to_explain" and ultra.calls == []
    assert out["official_alerts"] == [] and out["uncertainty"]


# ── Route ───────────────────────────────────────────────────────────────────

@pytest.fixture
def client(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")
    get_settings.cache_clear()
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def test_route_returns_a_brief_and_validates_dates(client, db_url, monkeypatch):
    seed(db_url)
    no_web(monkeypatch)
    monkeypatch.setattr(trip, "_ultra", lambda: None)
    trip._asked.clear()
    r = client.post("/v1/trips/brief", json={"lat": PHAKDING[0], "lon": PHAKDING[1], "place_name": "Phakding"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["trip"] == {"start_date": TODAY.isoformat(), "end_date": (TODAY + timedelta(days=3)).isoformat()}
    assert out["destination"]["radius_km"] == 25 and out["ai_status"] == "unavailable"
    assert json.dumps(out).count("Bridge washed out") == 1
    bad = client.post("/v1/trips/brief", json={"lat": 1, "lon": 1, "start_date": "2026-01-01"})
    assert bad.status_code == 422
    assert client.get("/v1/config").json()["flags"]["trip_briefing"] is True


def test_route_through_the_api(client, db_url, monkeypatch):
    seed(db_url)
    no_web(monkeypatch)
    monkeypatch.setattr(trip, "_ultra", lambda: None)
    trip._asked.clear()
    stops = [{"lat": s.lat, "lon": s.lon, "name": s.name} for s in ROUTE]
    r = client.post("/v1/trips/brief", json={"stops": stops, "radius_km": 10})
    assert r.status_code == 200, r.text
    out = r.json()
    assert [s["name"] for s in out["route"]["stops"]] == ["West", "Phakding", "East"]
    assert out["route"]["length_km"] == pytest.approx(98.4, abs=1)
    assert out["destination"]["place_name"] == "East"
    assert [a["near_stop"] for a in out["official_alerts"]] == ["Phakding", "Phakding"]
    assert any("straight lines between your stops" in n for n in out["uncertainty"])
    # Either a destination or a route; 2-8 stops; at most 500 km.
    assert client.post("/v1/trips/brief", json={"stops": stops[:1]}).status_code == 422
    assert client.post("/v1/trips/brief", json={"stops": stops, "lat": 1, "lon": 1}).status_code == 422
    assert client.post("/v1/trips/brief", json={"radius_km": 10}).status_code == 422
    far = [{"lat": 27.7, "lon": 85.3}, {"lat": 27.7, "lon": 91.0}]
    assert client.post("/v1/trips/brief", json={"stops": far}).status_code == 422


def test_dates_default_and_bounds():
    from moby.api.app import TripBriefRequest

    req = TripBriefRequest(lat=0, lon=0)
    assert req.end_date - req.start_date == timedelta(days=3)
    with pytest.raises(ValueError):
        TripBriefRequest(lat=0, lon=0, start_date=TODAY, end_date=TODAY + timedelta(days=40))
    with pytest.raises(ValueError):
        TripBriefRequest(lat=0, lon=0, start_date=date(2020, 1, 1))
