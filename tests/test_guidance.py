"""Offline guidance (migration 0008): grounding checks, draft → review → publish, public routes."""
import json
from datetime import datetime, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.config import get_settings
from typing import get_args

import httpx

from moby.api.guidance import Region
from moby.jobs import guidance as job
from moby.jobs.guidance import _cited, cards_for, grounding_problem, page_text, Source
from moby.search.official import OFFICIAL

from .test_chains_and_preferences import _test_db_url

TOKEN = "test-service-token"


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


@pytest.fixture
def client(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")     # caller is a reviewer
    monkeypatch.setenv("MOBY_SERVICE_TOKEN", TOKEN)
    get_settings.cache_clear()
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE guidance_bundles CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def card(card_id="flood-ready-turn-around", **kw):
    return {"card_id": card_id, "hazard_type": "flood", "title": "Turn around, don't drown",
            "body": "Do not walk, swim or drive through flood waters.", "priority": 10,
            "source_name": "FEMA Ready.gov", "source_url": "https://www.ready.gov/floods",
            "last_reviewed_at": datetime.now(timezone.utc).isoformat(), "is_critical_fallback": True,
            "evidence": ["Do not walk, swim or drive through flood waters."], **kw}


def store(client, cards, region="US"):
    return client.post("/internal/v1/guidance/bundles", headers={"Authorization": f"Bearer {TOKEN}"},
                       json={"region": region, "model": "test-ultra", "cards": cards})


# ── Grounding ────────────────────────────────────────────────────────

PAGE = page_text("""<html><nav>Menu Home</nav><main>
<h2>If you are under a flood warning</h2>
<ul><li>Find safe shelter right away.</li>
<li>Do not walk, swim or drive through flood waters. Turn Around, Don’t Drown!</li>
<li>Remember, just six inches of moving water can knock you down, and one foot of moving water can sweep your vehicle away.</li>
<li>Stay off bridges over 12 fast-moving water.</li></ul></main><footer>Contact us</footer></html>""")


def test_page_text_drops_chrome():
    assert "Menu" not in PAGE and "Contact us" not in PAGE and PAGE.startswith("If you are under a flood warning")


def test_cited_lines_are_verbatim_and_validated():
    lines = PAGE.split("\n")
    assert _cited(["L2", "3", 3, 99, "x"], lines) == [lines[1], lines[2]]
    assert _cited("L2", lines) == [lines[1]]


def test_grounding_rejects_invented_advice_and_numbers():
    lines = PAGE.split("\n")
    ok = {"title": "Under a flood warning", "body": "Find safe shelter right away. Do not walk, swim or drive "
          "through flood waters. Turn around, don't drown."}
    assert grounding_problem(ok, lines[1:3]) is None
    assert "cites no valid" in grounding_problem(ok, [])
    invented = {"title": "Under a flood warning", "body": "Fill the bathtub, tape the windows and call your insurer."}
    assert "words are in the cited lines" in grounding_problem(invented, lines[1:3])
    bad_number = {"title": "Bridges", "body": "Stay off bridges over 15 fast-moving water."}
    assert "numbers not in" in grounding_problem(bad_number, [lines[4]])


class FakeLLM:
    def __init__(self, content):
        self.content = content

    def invoke(self, _):
        return self


def test_cards_for_keeps_grounded_and_drops_the_rest():
    src = Source("flood", "FEMA Ready.gov", "https://www.ready.gov/floods")
    out = """```json
    [{"slug": "Under Warning!", "title": "Under a flood warning", "body": "Find safe shelter right away. Do not walk, swim or drive through flood waters.", "lines": ["L2", "L3"], "priority": "10", "is_critical_fallback": true},
     {"slug": "made-up", "title": "Prepare", "body": "Buy sandbags and move valuables upstairs today.", "lines": [2]}]
    ```"""
    kept, dropped = cards_for(src, PAGE, FakeLLM(out), "2026-10-04T00:00:00+00:00")
    assert [c["card_id"] for c in kept] == ["flood-ready-under-warning"]
    assert kept[0]["priority"] == 10 and kept[0]["is_critical_fallback"] is True
    assert kept[0]["evidence"] == PAGE.split("\n")[1:3]
    assert len(dropped) == 1 and "made-up" in dropped[0]


def test_unusable_model_output_drops_everything():
    kept, dropped = cards_for(Source("flood", "x", "https://x.gov"), PAGE, FakeLLM("I can't help"), "2026-10-04")
    assert kept == [] and "unusable" in dropped[0]


# ── Other countries: reviewed sources, English cards from local-language pages ──

def test_every_source_is_an_official_https_page_for_its_country():
    for country, sources in job.SOURCES.items():
        domains = OFFICIAL[country]
        for s in sources:
            host = httpx.URL(s.url).host
            assert s.url.startswith("https://") and s.hazard in job.HAZARDS and s.lang in job.LANGUAGES, s
            assert any(host == d or host.endswith("." + d) for d in domains), f"{s.url} is not on {domains}"
    assert job.SOURCES["CN"], "China needs reviewed sources"


def test_job_only_uploads_regions_the_api_takes():
    assert set(job.REGIONS) == set(get_args(Region))


ZH_PAGE = "\n".join([
    "首页>应急科普>自然灾害",
    "在家中，就近躲在结实、不易倾倒的家具下面，或躲在墙角、卫生间，不要使用电梯逃生。",
    "在户外，要躲开建筑物、桥梁或山坡，寻找空旷的安全地点。",
    "积水到60厘米左右车辆大概率熄火。",
])
ZH_SRC = Source("earthquake", "Ministry of Emergency Management (China)",
                "https://www.mem.gov.cn/kp/zrzh/202205/t20220512_413512.shtml", "zh")
ZH_TRANSLATION = """{"1": "Home > Emergency science > Natural disasters",
  "2": "At home, hide under sturdy furniture that will not easily fall over nearby, or hide in a corner or bathroom; do not use the elevator to escape.",
  "3": "Outdoors, keep away from buildings, bridges or hillsides, and find an open, safe place.",
  "4": "When standing water reaches about 60 cm, a vehicle will very likely stall."}"""


class ScriptedLLM:
    """Gives scripted replies in order (translation first, then cards) and records the prompts."""

    def __init__(self, *contents):
        self.contents, self.prompts = list(contents), []

    def invoke(self, prompt):
        self.prompts.append(prompt)
        self.content = self.contents.pop(0)
        return self


def test_chinese_page_is_translated_first_and_cards_are_written_from_the_english():
    cards = """[{"slug": "indoors", "title": "Earthquake at home", "body": "Hide under sturdy furniture or in a corner or bathroom. Do not use the elevator.", "lines": ["L2"], "priority": 10, "is_critical_fallback": true},
      {"slug": "outdoors", "title": "Earthquake outdoors", "body": "Keep away from buildings, bridges and hillsides. Find an open, safe place.", "lines": [3]},
      {"slug": "invented", "title": "Earthquake outdoors", "body": "Stand in a doorway and call your embassy straight away.", "lines": [3]},
      {"slug": "water", "title": "Standing water", "body": "When standing water reaches about 50 cm, a vehicle will very likely stall.", "lines": [4]}]"""
    llm = ScriptedLLM(ZH_TRANSLATION, cards)
    kept, dropped = cards_for(ZH_SRC, ZH_PAGE, llm, "2026-10-18T00:00:00+00:00", "CN")

    assert "from Chinese into English" in llm.prompts[0] and "L2: 在家中" in llm.prompts[0]
    # The card prompt sees the English lines, not the Chinese ones.
    assert "L2: At home, hide" in llm.prompts[1] and "在家中" not in llm.prompts[1]
    assert [c["card_id"] for c in kept] == ["cn-earthquake-mem-indoors", "cn-earthquake-mem-outdoors"]
    assert kept[0]["source_name"] == "Ministry of Emergency Management (China)" and kept[0]["source_url"] == ZH_SRC.url
    # The reviewer sees the original line and the translation the check used.
    assert kept[0]["evidence"][0].startswith(ZH_PAGE.split("\n")[1]) and "\n[EN] At home" in kept[0]["evidence"][0]
    assert any("invented" in d and "words are in the cited lines" in d for d in dropped)
    assert any("water" in d and "numbers not in" in d for d in dropped)


def test_translation_cannot_add_a_number():
    card = {"title": "Standing water", "body": "When standing water reaches about 50 cm, a vehicle will very likely stall."}
    padded = ["When standing water reaches about 50 cm, a vehicle will very likely stall."]
    assert "numbers not in" in grounding_problem(card, [ZH_PAGE.split("\n")[3]], padded)


def test_untranslated_lines_and_unusable_translations_drop_cards():
    cards = """[{"slug": "indoors", "title": "Earthquake at home", "body": "Hide under sturdy furniture. Do not use the elevator.", "lines": [2]}]"""
    llm = ScriptedLLM('{"3": "Outdoors, keep away from buildings."}', cards)
    kept, dropped = cards_for(ZH_SRC, ZH_PAGE, llm, "2026-10-18", "CN")
    assert "L2: (untranslated)" in llm.prompts[1] and kept == [] and "no translation" in dropped[0]
    kept, dropped = cards_for(ZH_SRC, ZH_PAGE, ScriptedLLM("Sorry"), "2026-10-18", "CN")
    assert kept == [] and "translation unusable" in dropped[0]


def test_translation_echoed_as_numbered_lines_is_accepted():
    cards = """[{"slug": "indoors", "title": "Earthquake at home", "body": "Hide under sturdy furniture or in a corner or bathroom. Do not use the elevator.", "lines": [2]}]"""
    echoed = "L2: At home, hide under sturdy furniture nearby, or hide in a corner or bathroom; do not use the elevator."
    kept, dropped = cards_for(ZH_SRC, ZH_PAGE, ScriptedLLM(echoed, cards), "2026-10-18", "CN")
    assert [c["card_id"] for c in kept] == ["cn-earthquake-mem-indoors"], dropped


def test_slightly_broken_translation_json_is_still_read():
    # Seen from Ultra on 2026-10-18: a stray quote before a key.
    raw = '{\n  "48": "Emergency science",\n  " "49": "Life safety",\n  "50": "Natural \\"disasters\\""\n}'
    assert job._parse_translation(raw) == {48: "Emergency science", 49: "Life safety", 50: 'Natural "disasters"'}


def test_long_pages_are_translated_in_chunks(monkeypatch):
    monkeypatch.setattr(job, "TRANSLATE_CHUNK_LINES", 2)
    llm = ScriptedLLM('{"1": "a", "2": "b"}', '{"3": "c", "4": "d"}')
    assert job.translate_page(llm, ZH_PAGE.split("\n"), "Chinese") == ["a", "b", "c", "d"]
    assert "L3:" in llm.prompts[1] and "L1:" not in llm.prompts[1]


def test_translated_card_prompt_restates_the_format_after_the_page():
    llm = ScriptedLLM(ZH_TRANSLATION, "A summary of the page.")
    kept, dropped = cards_for(ZH_SRC, ZH_PAGE, llm, "2026-10-18", "CN")
    assert "No summary, no headings, no prose." in llm.prompts[1].split(">>>")[-1]
    assert kept == [] and "starts 'A summary" in dropped[0]


def test_cards_are_for_the_public_and_a_focus_narrows_the_page():
    llm = ScriptedLLM(ZH_TRANSLATION, "[]")
    focused = Source("storm", "China Meteorological Administration", ZH_SRC.url, "zh", "typhoon warning signals")
    cards_for(focused, ZH_PAGE, llm, "2026-10-18", "CN")
    assert "Leave out duties of government" in llm.prompts[1]
    assert "Only write cards about typhoon warning signals." in llm.prompts[1]
    llm = ScriptedLLM(ZH_TRANSLATION, "[]")
    cards_for(ZH_SRC, ZH_PAGE, llm, "2026-10-18", "CN")
    assert "Only write cards about" not in llm.prompts[1]


def test_a_page_listed_with_several_focuses_is_translated_once():
    shared: dict[str, list[str]] = {}
    llm = ScriptedLLM(ZH_TRANSLATION, "[]", "[]")
    for focus in ("typhoon warning signals", "rainstorm warning signals"):
        cards_for(Source("storm", "CMA", ZH_SRC.url, "zh", focus), ZH_PAGE, llm, "2026-10-18", "CN", shared)
    assert len(llm.prompts) == 3 and "into English" in llm.prompts[0] and "into English" not in llm.prompts[2]
    assert shared[ZH_SRC.url][1].startswith("At home")


def test_job_fetches_and_translates_a_shared_page_once(monkeypatch, capsys):
    url = "https://www.gov.cn/gongbao/content/2008/content_912553.htm"
    monkeypatch.setitem(job.SOURCES, "CN", [Source("storm", "CMA", url, "zh", "typhoon"),
                                            Source("flood", "CMA", url, "zh", "rainstorm")])
    fetched = []
    monkeypatch.setattr(job, "fetch", lambda _client, u: fetched.append(u) or ZH_PAGE)
    card = '[{"slug": "%s", "title": "Earthquake at home", "body": "Hide under sturdy furniture or in a corner or bathroom.", "lines": [2]}]'
    llm = ScriptedLLM(ZH_TRANSLATION, card % "a", card % "b")
    monkeypatch.setattr(job, "job_model", lambda _country: llm)
    monkeypatch.setattr("sys.argv", ["guidance", "--country", "CN", "--dry-run"])
    assert job.main() == 0
    assert fetched == [url] and len(llm.prompts) == 3
    assert [c["card_id"] for c in json.loads(capsys.readouterr().out)] == ["cn-storm-gov-a", "cn-flood-gov-b"]


def test_sources_are_unique_and_a_shared_page_has_one_language():
    for sources in job.SOURCES.values():
        keys = [(s.url, s.focus) for s in sources]
        assert len(keys) == len(set(keys))
        langs: dict[str, str] = {}
        for s in sources:
            assert langs.setdefault(s.url, s.lang) == s.lang


def test_english_pages_need_no_translation_call():
    src = Source("flood", "FEMA Ready.gov", "https://www.ready.gov/floods")
    out = '[{"slug": "s", "title": "Under a flood warning", "body": "Find safe shelter right away.", "lines": [1, 2]}]'
    llm = ScriptedLLM(out)
    kept, _ = cards_for(src, PAGE, llm, "2026-10-04")
    assert len(llm.prompts) == 1 and "literal English translation" not in llm.prompts[0]
    assert llm.prompts[0].rstrip().endswith(">>>")  # no restated format for English pages
    assert kept[0]["card_id"] == "flood-ready-s"


def test_bundles_for_countries_the_api_doesnt_take_are_dry_run_only(monkeypatch):
    monkeypatch.setattr("sys.argv", ["guidance", "--country", "JP"])
    with pytest.raises(SystemExit) as e:
        job.main()
    assert e.value.code == 2


# ── Draft → review → publish ─────────────────────────────────────────

def test_nothing_is_public_until_published(client):
    assert store(client, [card()]).status_code == 201
    assert client.get("/v1/guidance/manifest").json() == {"bundles": []}
    assert client.get("/v1/guidance/cards?region=US").json()["cards"] == []


def test_internal_route_needs_the_service_token(client):
    r = client.post("/internal/v1/guidance/bundles", json={"region": "US", "model": "m", "cards": [card()]})
    assert r.status_code in (401, 403)


def test_review_drop_publish_and_serve(client):
    b = store(client, [card(), card("flood-ready-after", title="After a flood", is_critical_fallback=False,
                                     priority=40)]).json()
    detail = client.get(f"/v1/review/guidance/{b['bundle_id']}").json()
    assert detail["status"] == "draft" and detail["cards"][0]["evidence"]
    assert client.delete(f"/v1/review/guidance/{b['bundle_id']}/cards/flood-ready-after").status_code == 204
    assert client.post(f"/v1/review/guidance/{b['bundle_id']}/publish").status_code == 204
    assert client.post(f"/v1/review/guidance/{b['bundle_id']}/publish").status_code == 409

    (bundle,) = client.get("/v1/guidance/manifest?region=US").json()["bundles"]
    assert bundle["card_count"] == 1 and bundle["hazard_types"] == ["flood"]
    body = client.get("/v1/guidance/cards?region=US").json()
    assert [c["card_id"] for c in body["cards"]] == ["flood-ready-turn-around"]
    assert "evidence" not in body["cards"][0] and body["content_hash"] == bundle["content_hash"]
    assert client.get("/v1/guidance/cards?region=US&hazard_type=fire").json()["cards"] == []
    assert client.get("/v1/guidance/cards?region=US&bundle_version=old").status_code == 409
    # Published bundles are frozen.
    assert client.delete(f"/v1/review/guidance/{b['bundle_id']}/cards/flood-ready-turn-around").status_code == 409


def test_publishing_a_new_version_retires_the_old_one(client):
    first = store(client, [card()]).json()
    client.post(f"/v1/review/guidance/{first['bundle_id']}/publish")
    second = store(client, [card(), card("flood-ready-more", title="More")]).json()
    assert second["version"] != first["version"]
    client.post(f"/v1/review/guidance/{second['bundle_id']}/publish")
    (live,) = client.get("/v1/guidance/manifest").json()["bundles"]
    assert live["version"] == second["version"] and live["card_count"] == 2


def test_bundle_validation(client):
    assert store(client, [card(), card()]).status_code == 422                       # duplicate ids
    assert store(client, [card(source_url="http://insecure.example")]).status_code == 422
    assert store(client, [card(evidence=[])]).status_code == 422


def test_us_and_cn_bundles_are_live_side_by_side(client):
    us = store(client, [card()]).json()
    cn = store(client, [card("cn-earthquake-mem-indoors", hazard_type="earthquake",
                             source_name="Ministry of Emergency Management (China)",
                             source_url="https://www.mem.gov.cn/kp/zrzh/202205/t20220512_413512.shtml",
                             evidence=["在家中，就近躲在结实的家具下面。\n[EN] At home, hide under sturdy furniture."])],
               region="CN").json()
    assert cn["bundle_id"].startswith("cn-")
    for b in (us, cn):
        assert client.post(f"/v1/review/guidance/{b['bundle_id']}/publish").status_code == 204
    assert [b["bundle_id"] for b in client.get("/v1/guidance/manifest?region=US").json()["bundles"]] == [us["bundle_id"]]
    (live,) = client.get("/v1/guidance/manifest?region=CN").json()["bundles"]
    assert live["bundle_id"] == cn["bundle_id"]
    (c,) = client.get("/v1/guidance/cards?region=CN").json()["cards"]
    assert c["source_name"] == "Ministry of Emergency Management (China)" and "evidence" not in c
