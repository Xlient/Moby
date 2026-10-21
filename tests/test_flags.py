""""This looks wrong" flags (migration 0026): create, rate limit, review list, export, erase, retention."""
import asyncio
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.api.auth import reporter_hash
from moby.api.flags import EXCERPT_CHARS, MAX_FLAGS_PER_HOUR
from moby.config import get_settings
from moby.privacy.retention import apply_retention

from .test_chains_and_preferences import _test_db_url

ME = reporter_hash("dev-user")      # MOBY_AUTH_DISABLED: every request is "dev-user", a reviewer


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


@pytest.fixture
def client(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("MOBY_AUTH_DISABLED", "true")
    get_settings.cache_clear()
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events, reports, review_queue, content_flags, erasure_log CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def community_event(db_url) -> tuple[str, str]:
    """A community event with one fused report: (event_id, report_id)."""
    with psycopg.connect(db_url, autocommit=True) as c:
        (eid,) = c.execute(
            "INSERT INTO events (source, hazard_type, severity, location, tier, confidence, distinct_reporter_count) "
            "VALUES ('manual', 'flood', 'high', ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, 0, 0.4, 1) "
            "RETURNING event_id").fetchone()
        (rid,) = c.execute(
            "INSERT INTO reports (client_event_id, event_id, fusion_status, reporter_hash, hazard_type, severity, "
            "location, observed_at) VALUES (%s, %s, 'fused', 'someone-else', 'flood', 'high', "
            "ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, now()) RETURNING report_id",
            (str(uuid.uuid4()), eid)).fetchone()
    return str(eid), str(rid)


def flag(client, **body):
    return client.post("/v1/flags", json={"reason": "wrong", **body})


def test_flag_an_ask_answer_stores_the_capped_excerpt(client, db_url):
    r = flag(client, kind="ask_answer", excerpt="  Drive through the water. " + "x" * 3000, note=" bad advice ")
    assert r.status_code == 201 and r.json()["status"] == "received"
    with psycopg.connect(db_url) as c:
        kind, excerpt, note, who = c.execute(
            "SELECT kind, excerpt, note, reporter_hash FROM content_flags").fetchone()
    assert kind == "ask_answer" and excerpt.startswith("Drive through") and len(excerpt) == EXCERPT_CHARS
    assert note == "bad advice" and who == ME


def test_flag_validation(client, db_url):
    eid, _ = community_event(db_url)
    assert flag(client, kind="ask_answer").status_code == 422                       # nothing to point at
    assert flag(client, kind="explanation", target_id="not-a-uuid").status_code == 422
    assert flag(client, kind="explanation", target_id=eid, reason="meh").status_code == 422
    assert flag(client, kind="brief", target_id=eid, note="x" * 501).status_code == 422
    assert flag(client, kind="brief", target_id=str(uuid.uuid4())).status_code == 404
    assert flag(client, kind="community_report", target_id=str(uuid.uuid4())).status_code == 404
    assert flag(client, kind="explanation", target_id=eid).status_code == 201


def test_flagged_community_report_is_queued_for_take_down(client, db_url):
    eid, rid = community_event(db_url)
    assert flag(client, kind="community_report", target_id=rid, reason="spam").status_code == 201
    queue = client.get("/v1/review/queue").json()
    assert [(i["event_id"], i["reason"]) for i in queue] == [(eid, "user_flag")]

    flags = client.get("/v1/review/flags").json()
    assert len(flags) == 1 and flags[0]["kind"] == "community_report" and flags[0]["event_id"] == eid
    assert flags[0]["in_review_queue"] is True and flags[0]["taken_down"] is False

    # The existing Reject takes it down; a later flag doesn't reopen a rejected event.
    assert client.post(f"/v1/review/{eid}/decision", json={"decision": "reject"}).status_code == 204
    assert flag(client, kind="community_report", target_id=rid).status_code == 201
    assert client.get("/v1/review/queue").json() == []
    assert all(f["taken_down"] for f in client.get("/v1/review/flags").json())


def test_flag_reopens_an_approved_event(client, db_url):
    eid, rid = community_event(db_url)
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("INSERT INTO review_queue (event_id, reason, status, decision) "
                  "VALUES (%s, 'tier1_corroborated', 'decided', 'approve')", (eid,))
    assert flag(client, kind="community_report", target_id=rid).status_code == 201
    assert [i["reason"] for i in client.get("/v1/review/queue").json()] == ["user_flag"]


def test_resolve_removes_a_flag_from_the_list(client):
    flag(client, kind="trip_brief", excerpt="Roads are clear near Redding.")
    (f,) = client.get("/v1/review/flags").json()
    assert f["excerpt"].startswith("Roads") and "event_id" not in f
    assert client.post(f"/v1/review/flags/{f['flag_id']}/resolve").status_code == 204
    assert client.get("/v1/review/flags").json() == []
    assert client.post(f"/v1/review/flags/{f['flag_id']}/resolve").status_code == 404


def test_rate_limit(client, db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("INSERT INTO content_flags (reporter_hash, kind, excerpt, reason) "
                  "SELECT %s, 'ask_answer', 'x', 'wrong' FROM generate_series(1, %s)", (ME, MAX_FLAGS_PER_HOUR))
    r = flag(client, kind="ask_answer", excerpt="one more")
    assert r.status_code == 429 and r.headers["Retry-After"]


def test_export_and_erase(client, db_url):
    flag(client, kind="ask_answer", excerpt="mine", note="my note")
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("INSERT INTO content_flags (reporter_hash, kind, excerpt, reason) VALUES ('someone-else', 'ask_answer', 'theirs', 'spam')")
        c.execute("INSERT INTO content_flags (reporter_hash, kind, excerpt, reason, status, resolved_by) "
                  "VALUES ('someone-else', 'ask_answer', 'resolved by me', 'spam', 'resolved', %s)", (ME,))
    exported = client.get("/v1/me/export").json()["content_flags"]
    assert [(f["excerpt"], f["note"]) for f in exported] == [("mine", "my note")]

    assert client.delete("/v1/me").status_code == 204
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT count(*) FROM content_flags WHERE reporter_hash = %s", (ME,)).fetchone() == (0,)
        assert c.execute("SELECT count(*) FROM content_flags").fetchone() == (2,)                # others' stay
        assert c.execute("SELECT count(*) FROM content_flags WHERE resolved_by IS NOT NULL").fetchone() == (0,)
    assert client.get("/v1/me/export").json()["content_flags"] == []


def test_retention_deletes_old_flags(db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE content_flags")
        c.execute("INSERT INTO content_flags (reporter_hash, kind, excerpt, reason, created_at) VALUES "
                  "(%s, 'ask_answer', 'old', 'wrong', now() - interval '91 days'), "
                  "(%s, 'ask_answer', 'new', 'wrong', now() - interval '1 day')", (ME, ME))

    async def run():
        async with await psycopg.AsyncConnection.connect(db_url, autocommit=True) as conn:
            return await apply_retention(conn)
    assert asyncio.run(run())["flags_deleted"] == 1
    assert asyncio.run(run())["flags_deleted"] == 0
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT excerpt FROM content_flags").fetchall() == [("new",)]
