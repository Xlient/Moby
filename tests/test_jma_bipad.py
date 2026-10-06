"""Japan (JMA) and Nepal (BIPAD) feeds (issue #10), from saved real responses."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from moby.feeds import bipad, jma

FIX = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIX / name).read_text())


def test_jma_quakes():
    items = load("jma_quakes.json")
    felt = [q for q in items if q.get("maxi") in jma.SHINDO and q.get("ttl") == "震源・震度情報"]
    assert felt, "fixture needs at least one shindo 3+ hypocentre report"
    newest = max(datetime.fromisoformat(q["at"]) for q in felt)
    r = jma.normalize_quakes(items, now=newest + timedelta(hours=1))
    assert r.events, r.skipped
    for e in r.events:
        assert e.source_feed == "jma" and e.country == "JP" and e.external_id.startswith("eq-")
        assert e.raw_payload["properties"]["shindo"] in jma.SHINDO
        assert e.title.endswith(e.raw_payload["properties"]["areaDesc"]) and e.area_wkt
    assert len({e.external_id for e in r.events}) == len(r.events)        # one event per quake
    assert r.skipped["not_hypocentre_report"] > 0
    assert jma.normalize_quakes(items, now=newest + timedelta(days=2)).events == []   # older than a day


def test_jma_iso6709_and_shindo_scale():
    assert jma._iso6709("+39.1+142.1-40000/") == (39.1, 142.1)
    assert jma._iso6709("-8.3+115.5/") == (-8.3, 115.5)
    assert [jma.SHINDO[s][0] for s in ("3", "4", "5-", "6+")] == ["low", "medium", "high", "critical"]


def test_jma_volcanoes():
    volcanoes = {v["code"]: v for v in load("jma_volcano_list.json")}
    r = jma.normalize_volcanoes(load("jma_volcano_warning.json"), volcanoes)
    by_id = {e.external_id: e for e in r.events}
    level3 = [e for e in r.events if e.title.endswith("Level 3: do not approach the volcano")]
    assert level3 and all(e.severity == "high" for e in level3)
    assert any("Sakurajima" in e.title for e in r.events)
    assert all(e.external_id.startswith("vol-") and e.hazard_type == "other" for e in r.events)
    assert len(by_id) == len(r.events)
    assert r.skipped.get("level_1_or_unknown", 0) >= 1                # level 1 is not a hazard


def test_bipad():
    payload = load("bipad_alerts.json")
    started = [datetime.fromisoformat(a["startedOn"]) for a in payload["results"]]
    r = bipad.normalize(payload, now=min(started))                     # as if read when the oldest was new
    kinds = {e.raw_payload["properties"]["referenceType"] for e in r.events}
    assert kinds <= {"river", "rain", "road"} and r.events
    assert all(e.country == "NP" and e.source_feed == "bipad" for e in r.events)
    assert all(e.expires_at > min(started) for e in r.events)
    assert bipad.normalize(payload, now=max(started) + timedelta(days=30)).events == []   # all lapsed


def test_bipad_river_above_danger_level_is_high():
    alert = {"id": 1, "title": "Flood warning at Chisapani, Kailali", "referenceType": "river", "source": "dhm",
             "point": {"type": "Point", "coordinates": [81.27, 28.64]}, "expireOn": None,
             "startedOn": "2026-10-04T10:00:00+05:45",
             "description": "Basin:Karnali Warning level:10.0 Danger level:10.8 Water level:11.2"}
    now = datetime(2026, 10, 4, 5, 0, tzinfo=timezone.utc)
    (e,) = bipad.normalize({"results": [alert]}, now=now).events
    assert e.severity == "high" and e.hazard_type == "flood" and e.raw_payload["properties"]["areaDesc"] == "Chisapani, Kailali"
    road = {**alert, "id": 2, "referenceType": "road", "source": "dor", "title": "Road closed in Gajuri-2, Dhading",
            "description": "Road is closed due to Landslide"}
    (r,) = bipad.normalize({"results": [road]}, now=now).events
    assert r.hazard_type == "landslide" and r.raw_payload["properties"]["authority"] == "Department of Roads (Nepal)"
