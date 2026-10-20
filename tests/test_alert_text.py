"""Official alerts in the phone's language (moby/ai/alert_text.py): a Spanish warning on a
Japanese phone reads in Japanese, straight from the Spanish; on a Spanish phone, the original."""
import asyncio
import uuid
from datetime import datetime, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.ai import alert_text
from moby.api.alerts import to_alert
from moby.config import get_settings
from moby.delivery.worker import build_push

from .test_chains_and_preferences import _test_db_url

NOW = datetime.now(timezone.utc)
JA = {"headline": "オアハカに大雨警報", "body": "75〜150 mmの雨。"}
ROW = {"event_id": uuid.uuid4(), "source": "official", "source_feed": "cap", "severity": "high", "tier": 2,
       "title": "Aviso de lluvias intensas en Oaxaca", "description": "Lluvias de 75 a 150 mm.",
       "hazard_type": "flood", "first_reported_at": NOW, "last_updated_at": NOW, "lat": 17.0, "lon": -96.7,
       "product": "Aviso", "raw_payload": {"properties": {"areaDesc": "Oaxaca"}},
       "language": "es-MX", "translation_status": "done", "title_en": "Heavy rain warning in Oaxaca",
       "description_en": "Rain of 75 to 150 mm.", "translations": {}, "push_token": "t" * 40}


def test_the_phone_reads_the_original_its_language_or_english():
    assert to_alert(ROW, "es-ES")["headline"].startswith("Aviso de lluvias intensas")      # same language
    assert "translated" not in to_alert(ROW, "es-ES")
    ja = to_alert(ROW | {"translations": {"ja": JA}}, "ja-JP")
    assert ja["headline"] == JA["headline"] and ja["body"] == JA["body"] and ja["translated"] is True
    assert ja["original_language"] == "Spanish" and ja["original_headline"].startswith("Aviso")
    assert to_alert(ROW, "ja-JP")["headline"] == "Heavy rain warning in Oaxaca"   # not translated yet: English
    assert to_alert(ROW | {"translations": {"ja": None}}, "ja-JP")["headline"] == "Heavy rain warning in Oaxaca"
    assert to_alert(ROW, "en-US")["headline"] == to_alert(ROW)["headline"] == "Heavy rain warning in Oaxaca"
    nws = ROW | {"source_feed": "noaa", "language": None, "translation_status": "none", "title_en": None,
                 "product": "Flood Warning", "translations": {"ja": {"headline": "洪水警報", "body": "川が増水。"}}}
    assert to_alert(nws, "ja")["headline"] == "洪水警報" and to_alert(nws, "ja")["original_language"] == "English"
    assert to_alert(nws, "en-GB")["headline"] == "Flood warning" and "translated" not in to_alert(nws, "en-GB")


class FakeLLM:
    def __init__(self, *replies):
        self.replies, self.prompts = list(replies), []

    async def ainvoke(self, prompt):
        self.prompts.append(prompt)
        return type("R", (), {"content": self.replies.pop(0)})()


def test_translation_is_checked_and_retried_once():
    dropped = '{"headline": "オアハカに大雨警報", "body": "雨。"}'          # 75 and 150 lost
    good = '{"headline": "オアハカに大雨警報", "body": "75〜150 mmの雨。"}'
    llm = FakeLLM(dropped, good)
    assert asyncio.run(alert_text.translate(llm, ROW, "ja")) == JA
    assert "from Spanish into Japanese" in llm.prompts[0] and "Aviso de lluvias" in llm.prompts[0]
    assert asyncio.run(alert_text.translate(FakeLLM(dropped, dropped), ROW, "ja")) is None
    # From English, names must survive: in Latin-script languages as written, or it's rejected…
    nws = ROW | {"source_feed": "noaa", "language": None, "product": "Flood Warning",
                 "description": "* WHERE...The Russian River near Guerneville.\n- An upper-level trough "
                                "brings Flash Flooding on Thursday; the river will rise to 32 feet."}
    renamed = '{"headline": "Aviso de inundación", "body": "El río Ruso cerca de Guernevil subirá a 32 pies el jueves."}'
    kept = '{"headline": "Aviso de inundación", "body": "El río Russian cerca de Guerneville subirá a 32 pies el jueves."}'
    llm = FakeLLM(renamed, kept)
    assert "Guerneville" in asyncio.run(alert_text.translate(llm, nws, "es"))["body"]
    assert "headline: Flood warning" in llm.prompts[0]           # the short headline the app shows, not the NWS title
    assert "Names in this text: Guerneville, Russian River" in llm.prompts[0]   # not "An", "Flash Flooding", "Thursday"
    # …while in other scripts a name written their way is kept, with the original listed first.
    ja = '{"headline": "洪水警報", "body": "ゲルネビル付近のロシアン川は木曜日に32フィートまで上昇。"}'
    out = asyncio.run(alert_text.translate(FakeLLM(ja), nws, "ja"))
    assert out["body"].startswith("📍 Guerneville · 📍 Russian River\n\n")


class FakeConn:
    def __init__(self):
        self.sql = []

    async def execute(self, sql, params=None):
        self.sql.append((sql, params))


def test_alert_in_translates_once_and_only_when_needed(monkeypatch):
    async def take(_conn, feature, n=1):
        assert feature == "alert_language"
        return n
    monkeypatch.setattr(alert_text.budget, "take", take)
    llm = FakeLLM('{"headline": "オアハカに大雨警報", "body": "75〜150 mmの雨。"}')
    monkeypatch.setattr(alert_text, "model", lambda: llm)
    row, conn = dict(ROW), FakeConn()
    assert asyncio.run(alert_text.alert_in(conn, row, "ja-JP")) == JA
    assert row["translations"] == {"ja": JA} and len(conn.sql) == 1          # cached on the event
    assert asyncio.run(alert_text.alert_in(conn, row, "ja")) == JA and len(llm.prompts) == 1
    for lang in ("es-AR", "en-US", "ne-NP", None):     # original, English, not a Moby language, unknown
        assert asyncio.run(alert_text.alert_in(conn, dict(ROW), lang)) is None
    assert asyncio.run(alert_text.alert_in(conn, ROW | {"source": "manual"}, "ja")) is None
    assert len(llm.prompts) == 1


def test_push_uses_the_phone_language_translation_and_keeps_the_label():
    p = build_push(ROW | {"translations": {"ja": JA}, "device_language": "ja-JP"})
    assert p.title == JA["headline"] and p.body.startswith("Oaxaca — 75〜150 mmの雨。")
    assert p.body.endswith("(Translated by Moby from Spanish)")
    assert build_push(ROW | {"device_language": "es-MX"}).title.startswith("Aviso de lluvias intensas")


# ── The routes ───────────────────────────────────────────────────────

@pytest.fixture
def client_db(monkeypatch):
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")
    get_settings.cache_clear()
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("TRUNCATE events CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c, url
    get_settings.cache_clear()


def test_opening_an_alert_translates_it_and_the_list_then_shows_it(client_db, monkeypatch):
    client, url = client_db
    with psycopg.connect(url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, title, description, "
            "language, translation_status, title_en, description_en, location) VALUES ('official', 'cap', %s, "
            "'flood', 'high', 2, 'Aviso de lluvias intensas en Oaxaca', 'Lluvias de 75 a 150 mm en la costa.', "
            "'es-MX', 'done', 'Heavy rain warning in Oaxaca', 'Rain of 75 to 150 mm on the coast.', "
            "ST_SetSRID(ST_MakePoint(-96.7, 17.0), 4326)::geography) RETURNING event_id",
            (str(uuid.uuid4()),)).fetchone()
    llm = FakeLLM('{"headline": "オアハカに大雨警報", "body": "沿岸で75〜150 mmの雨。"}')
    monkeypatch.setattr(alert_text, "model", lambda: llm)
    near = {"lat": 17.0, "lon": -96.7}
    assert client.get("/v1/alerts", params=near | {"lang": "ja-JP"}).json()["alerts"][0]["headline"] == \
        "Heavy rain warning in Oaxaca"                                   # the list never calls the model
    opened = client.get(f"/v1/alerts/{eid}", params={"lang": "ja-JP"}).json()
    assert opened["headline"] == "オアハカに大雨警報" and opened["translated"] is True
    listed = client.get("/v1/alerts", params=near | {"lang": "ja-JP"}).json()["alerts"][0]
    assert listed["headline"] == "オアハカに大雨警報" and len(llm.prompts) == 1
    assert client.get(f"/v1/alerts/{eid}", params={"lang": "es-MX"}).json()["headline"].startswith("Aviso")
    assert client.get(f"/v1/alerts/{eid}").json()["headline"] == "Heavy rain warning in Oaxaca"
