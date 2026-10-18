"""Moby's AI text in the reader's language, and the plain-language push."""
import asyncio
import json
from datetime import timedelta

import psycopg

from moby.ai import localize
from moby.delivery import worker

from .test_delivery import FakeSender, TOKEN, add_event, client, db_url, deliver  # noqa: F401  (fixtures)

EXPLAINED = {"summary": "The river is expected to rise 2 feet above flood stage. Low roads near the river will flood.",
             "actions": ["Move to higher ground."], "model": "super", "generated_at": "2026-10-15T00:00:00Z"}
SPANISH = {"headline": "Aviso de inundación",
           "summary": "Se espera que el río suba 2 pies por encima del nivel de inundación. Las carreteras bajas cerca del río se inundarán.",
           "actions": ["Suba a un terreno más alto."]}


class FakeNano:
    def __init__(self, reply):
        self.reply, self.calls = reply, 0

    async def ainvoke(self, _prompt):
        self.calls += 1
        return type("R", (), {"content": self.reply if isinstance(self.reply, str) else json.dumps(self.reply)})()


def test_normalize_phone_language_tags():
    assert localize.normalize("es-MX") == "es"
    assert localize.normalize("fil-PH") == "tl"
    assert localize.normalize("ja_JP") == "ja"
    assert localize.normalize("en-US") is None          # English needs no translation
    assert localize.normalize("xx") is None and localize.normalize(None) is None


def test_check_keeps_numbers_markers_and_shape():
    src = {"answer": "Just 12 inches of moving water can carry away a car [1]."}
    assert localize.check(src, {"answer": "Solo 12 pulgadas de agua pueden arrastrar un coche [1]."}) is None
    assert "numbers lost" in localize.check(src, {"answer": "Solo doce pulgadas de agua pueden arrastrar un coche [1]."})
    assert localize.check(src, {"answer": "Solo 12 pulgadas de agua pueden arrastrar un coche."}) == \
        "citation markers changed"
    assert localize.check({"a": ["x", "y"]}, {"a": ["x"]}) == "different structure"
    assert localize.check({"a": "Go now."}, {"a": " "}) == "empty field"


def test_localize_falls_back_to_none_on_bad_output():
    fields = {"answer": "Move to higher ground [1]."}
    assert asyncio.run(localize.localize(FakeNano({"answer": "Suba a un terreno más alto [1]."}), fields, "es")) == \
        {"answer": "Suba a un terreno más alto [1]."}
    assert asyncio.run(localize.localize(FakeNano("not json"), fields, "es")) is None
    assert asyncio.run(localize.localize(FakeNano({"answer": "Suba."}), fields, "es")) is None   # marker lost


# ── Pushes ─────────────────────────────────────────────────────────

LONG = "The river is expected to rise above flood stage near the town tonight. Low roads will flood."


def register(client, *, language=None):  # noqa: F811
    body = {"device_id": "device-0001", "push_provider": "fcm", "push_token": TOKEN, "platform": "android"}
    if language:
        body["language"] = language
    assert client.post("/v1/me/devices", json=body).status_code == 204
    assert client.put("/v1/me/near-me", json={"center": {"lat": 37.8044, "lon": -122.2711},
                                              "radius_km": 10}).status_code == 204


def set_event(db_url, eid, **cols):  # noqa: F811
    with psycopg.connect(db_url, autocommit=True) as c:
        for k, v in cols.items():
            c.execute(f"UPDATE events SET {k} = %s WHERE event_id = %s",
                      (psycopg.types.json.Jsonb(v) if isinstance(v, dict) else v, eid))


def backdate_device(db_url):  # noqa: F811
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("UPDATE devices SET registered_at = now() - interval '1 hour'")


def test_device_language_is_normalised(client, db_url):  # noqa: F811
    register(client, language="es-MX")
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT language FROM devices").fetchone()[0] == "es"
    register(client, language="xx-YY")
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT language FROM devices").fetchone()[0] is None


def test_fresh_warning_waits_for_its_explanation_but_critical_never_does(client, db_url, monkeypatch):  # noqa: F811
    monkeypatch.setattr(localize, "nano", lambda: FakeNano(SPANISH))
    register(client)
    backdate_device(db_url)
    held = add_event(db_url, severity="high")
    urgent = add_event(db_url, severity="critical", lat=37.81)
    set_event(db_url, held, description=LONG)
    set_event(db_url, urgent, description=LONG)
    sender = FakeSender()
    counts = deliver(db_url, sender)
    assert counts["held"] == 1 and counts["sent"] == 1
    assert [p.critical for p in sender.pushes] == [True]
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT explainer_status FROM events WHERE event_id = %s", (held,)).fetchone()[0] == "pending"


def test_held_warning_goes_out_with_official_text_after_the_hold(client, db_url, monkeypatch):  # noqa: F811
    monkeypatch.setattr(localize, "nano", lambda: FakeNano(SPANISH))
    monkeypatch.setattr(worker, "HOLD_FOR", timedelta(seconds=30))
    register(client)
    backdate_device(db_url)
    eid = add_event(db_url, severity="high", updated_minutes_ago=2)     # older than the hold
    set_event(db_url, eid, description=LONG, explainer_status="pending")
    sender = FakeSender()
    assert deliver(db_url, sender)["sent"] == 1
    assert "(Moby AI)" not in sender.pushes[0].body


def test_explained_push_is_in_the_phone_language_and_cached(client, db_url, monkeypatch):  # noqa: F811
    nano = FakeNano(SPANISH)
    monkeypatch.setattr(localize, "nano", lambda: nano)
    register(client, language="es-ES")
    backdate_device(db_url)
    eid = add_event(db_url, severity="high")
    set_event(db_url, eid, description=LONG, explainer=EXPLAINED, explainer_status="done")
    sender = FakeSender()
    assert deliver(db_url, sender)["sent"] == 1
    push = sender.pushes[0]
    assert push.title == "Aviso de inundación"
    assert push.body.startswith("Se espera que el río suba 2 pies") and push.body.endswith("(Moby AI)")
    with psycopg.connect(db_url) as c:
        cached = c.execute("SELECT explainer->'localized'->'es' FROM events WHERE event_id = %s", (eid,)).fetchone()[0]
    assert cached["summary"] == SPANISH["summary"] and nano.calls == 1


def test_english_phone_gets_the_english_explanation(client, db_url, monkeypatch):  # noqa: F811
    monkeypatch.setattr(localize, "nano", lambda: FakeNano(SPANISH))
    register(client)
    backdate_device(db_url)
    eid = add_event(db_url, severity="high")
    set_event(db_url, eid, description=LONG, explainer=EXPLAINED, explainer_status="done")
    sender = FakeSender()
    deliver(db_url, sender)
    assert sender.pushes[0].body.startswith("The river is expected to rise 2 feet")


def test_bad_translation_falls_back_to_english_and_is_not_retried(client, db_url, monkeypatch):  # noqa: F811
    nano = FakeNano({**SPANISH, "summary": "Se espera que el río suba mucho."})   # lost the "2"
    monkeypatch.setattr(localize, "nano", lambda: nano)
    register(client, language="es")
    backdate_device(db_url)
    eid = add_event(db_url, severity="high")
    set_event(db_url, eid, description=LONG, explainer=EXPLAINED, explainer_status="done")
    sender = FakeSender()
    deliver(db_url, sender)
    assert sender.pushes[0].body.startswith("The river is expected")
    row = {"event_id": eid, "explainer": {**EXPLAINED, "localized": {"es": None}}}
    assert asyncio.run(_explanation_in(db_url, row)) is None and nano.calls == 2   # one retry, then cached


async def _explanation_in(db_url, row):  # noqa: F811
    async with await psycopg.AsyncConnection.connect(db_url, autocommit=True) as conn:
        return await localize.explanation_in(conn, row, "es")


def test_explain_route_answers_in_the_requested_language(client, db_url, monkeypatch):  # noqa: F811
    monkeypatch.setattr(localize, "nano", lambda: FakeNano(SPANISH))
    eid = add_event(db_url, severity="high")
    set_event(db_url, eid, description=LONG, explainer=EXPLAINED, explainer_status="done")
    es = client.get(f"/v1/events/{eid}/explain", params={"lang": "es-MX"}).json()
    assert es["language"] == "es" and es["summary"] == SPANISH["summary"] and es["actions"] == SPANISH["actions"]
    en = client.get(f"/v1/events/{eid}/explain").json()
    assert en["language"] == "en" and en["summary"] == EXPLAINED["summary"]


def test_place_names_must_survive_translation():
    src = {"summary": "The Russian River will flood roads near Guerneville."}
    assert localize.check(src, {"summary": "El Russian River inundará carreteras cerca de Guerneville."}) is None
    assert "names changed" in localize.check(src, {"summary": "El río ruso inundará carreteras cerca de Guerneville."})


def test_generic_parts_of_names_may_be_translated():
    src = {"summary": "The Russian River will flood roads in Sonoma County."}
    assert localize.check(src, {"summary": "El río Russian inundará carreteras en el condado de Sonoma."}) is None
    assert "names changed" in localize.check(src, {"summary": "El río ruso inundará carreteras en el condado de Sonoma."})
