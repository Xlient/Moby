"""POST /v1/mesh/sync and GET /v1/mesh/alerts: the Bluetooth mesh gateway boundary.

Runs the real FastAPI app against the throwaway `moby_test` database; skipped when
Postgres isn't reachable (docker compose up -d).
"""
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from moby.api import mesh as mesh_module
from moby.api.reports import mesh_key
from moby.config import get_settings

from .test_chains_and_preferences import _test_db_url


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
        c.execute("TRUNCATE reports, sos_signals CASCADE")
    from moby.api.app import app
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def record(**kw) -> dict:
    base = {
        "event_id": uuid.uuid4().hex[:16],
        "hazard_type": 0,          # flood
        "lat_e6": 27_717_200,      # Kathmandu, rounded to 1e-4 like the radio format
        "lon_e6": 85_324_000,
        "severity": 2,             # high
        "hop_count": 2,
        "timestamp": int((datetime.now(timezone.utc) - timedelta(minutes=30)).timestamp()),
        "reporter_hash": "a1b2c3d4",
        "relayed_by": ["r1"],
    }
    return {**base, **kw}


def sync(client, *records):
    r = client.post("/v1/mesh/sync", json={"device_id": "gateway-1", "records": list(records)})
    assert r.status_code == 200, r.text
    return r.json()


def test_mesh_report_is_stored_as_an_unverified_community_report(client, db_url):
    rec = record()
    out = sync(client, rec)
    assert out == {"acknowledged": [rec["event_id"]], "rejected": []}
    with psycopg.connect(db_url) as c:
        row = c.execute(
            "SELECT source, reporter_hash, hazard_type, severity, fusion_status, captured_offline, note, "
            "ST_Y(location::geometry), relayed_by FROM reports WHERE mesh_key = %s", (rec["event_id"],)
        ).fetchone()
    assert row[:7] == ("mesh", "mesh:a1b2c3d4", "flood", "high", "pending", True, None)
    assert abs(row[7] - 27.7172) < 1e-6
    assert "r1" in row[8] and len(row[8]) == 2       # the relay it came through + this gateway


def test_sync_is_idempotent_and_relays_never_duplicate_a_report(client, db_url):
    rec = record()
    sync(client, rec)
    sync(client, rec)                                  # retry
    sync(client, {**rec, "relayed_by": ["r2"], "hop_count": 3})   # same report via another path
    with psycopg.connect(db_url) as c:
        rows = c.execute("SELECT relayed_by FROM reports WHERE mesh_key = %s", (rec["event_id"],)).fetchall()
    assert len(rows) == 1
    assert {"r1", "r2"} <= set(rows[0][0])


@pytest.mark.parametrize("bad, reason", [
    ({"hazard_type": 9}, "unknown_hazard_type"),
    ({"severity": 7}, "unknown_severity"),
    ({"lat_e6": 91_000_000}, "bad_location"),
    ({"hop_count": 40}, "too_many_hops"),
    ({"timestamp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())}, "in_the_future"),
    ({"timestamp": int((datetime.now(timezone.utc) - timedelta(days=8)).timestamp())}, "too_old"),
])
def test_bad_records_are_rejected_with_a_reason(client, bad, reason):
    rec = record(**bad)
    out = sync(client, rec)
    assert out["acknowledged"] == []
    assert out["rejected"] == [{"event_id": rec["event_id"], "reason": reason}]


def test_one_originator_cant_flood_the_mesh(client, monkeypatch):
    monkeypatch.setattr(mesh_module, "MAX_REPORTS_PER_HOUR", 2)
    out = sync(client, record(), record(), record())
    assert len(out["acknowledged"]) == 2
    assert out["rejected"][0]["reason"] == "rate_limited"


def test_reconnecting_reporter_upgrades_the_mesh_copy(client, db_url):
    """The reporter's own phone sends the full report (with the note) once it has signal.
    That must not count as a second report: the mesh copy becomes the full report."""
    cid = str(uuid.uuid4())
    sync(client, record(event_id=mesh_key(cid)))
    full = {
        "client_event_id": cid, "hazard_type": "flood", "observed_effect": "rising_water", "severity": "high",
        "location": {"lat": 27.71721, "lon": 85.32401, "accuracy_m": 8},
        "observed_at": datetime.now(timezone.utc).isoformat(), "note": "Water over the bridge",
        "captured_offline": True,
    }
    assert client.post("/v1/reports", json=full).status_code == 202
    assert client.post("/v1/reports", json=full).status_code == 202      # retry still idempotent
    with psycopg.connect(db_url) as c:
        rows = c.execute(
            "SELECT client_event_id, source, note, reporter_hash FROM reports WHERE mesh_key = %s", (mesh_key(cid),)
        ).fetchall()
    assert len(rows) == 1
    assert rows[0][:3] == (cid, "mesh", "Water over the bridge")
    assert not rows[0][3].startswith("mesh:")


def test_mesh_copy_arriving_after_the_full_report_is_not_a_second_report(client, db_url):
    cid = str(uuid.uuid4())
    full = {
        "client_event_id": cid, "hazard_type": "fire", "severity": "medium",
        "location": {"lat": 27.7, "lon": 85.3}, "observed_at": datetime.now(timezone.utc).isoformat(),
    }
    client.post("/v1/reports", json=full)
    out = sync(client, record(event_id=mesh_key(cid), hazard_type=1, severity=1))
    assert out["acknowledged"] == [mesh_key(cid)]
    with psycopg.connect(db_url) as c:
        n = c.execute("SELECT count(*) FROM reports WHERE mesh_key = %s", (mesh_key(cid),)).fetchone()[0]
    assert n == 1


def test_mesh_key_matches_the_app():
    # Same vector as src/mesh/codec.test.ts: the app and the API must agree.
    assert mesh_key("00000000-0000-4000-8000-000000000000") == "db8055e0e0307d5a"


def test_mesh_alerts_are_official_and_compact(client, db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events CASCADE")
        c.execute(
            """INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, confidence,
                                   title, location, first_reported_at, expires_at)
               VALUES ('official', 'bipad', 'x1', 'flood', 'high', 2, 1, 'Flood Warning',
                       ST_SetSRID(ST_MakePoint(85.33, 27.72), 4326)::geography, now() - interval '1 hour',
                       now() + interval '6 hours')"""
        )
    r = client.get("/v1/mesh/alerts", params={"lat": 27.7, "lon": 85.3})
    assert r.status_code == 200, r.text
    recs = r.json()["records"]
    assert len(recs) == 1
    rec = recs[0]
    assert rec["hazard_type"] == 0 and rec["severity"] == 2 and rec["hop_count"] == 0
    assert len(rec["event_id"]) == 16 and rec["reporter_hash"] == "00000000"
    assert abs(rec["lat_e6"] - 27_720_000) < 2


# ── SOS (hazard code 6) ──────────────────────────────────────────────

def sos(**kw) -> dict:
    return record(**{"hazard_type": mesh_module.SOS_CODE, "severity": 3, **kw})


def test_sos_is_stored_apart_from_reports_and_never_becomes_a_hazard(client, db_url):
    rec = sos()
    assert sync(client, rec) == {"acknowledged": [rec["event_id"]], "rejected": []}
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT count(*) FROM reports").fetchone()[0] == 0
        row = c.execute(
            "SELECT reporter_hash, status, hop_count, ST_Y(location::geometry) FROM sos_signals WHERE mesh_key = %s",
            (rec["event_id"],),
        ).fetchone()
    assert row[:3] == ("mesh:a1b2c3d4", "help", 2)
    assert abs(row[3] - 27.7172) < 1e-6


def test_sos_via_two_relays_is_one_signal_with_the_shortest_path(client, db_url):
    rec = sos()
    sync(client, rec)
    sync(client, {**rec, "relayed_by": ["r2"], "hop_count": 1})
    with psycopg.connect(db_url) as c:
        rows = c.execute("SELECT hop_count, relayed_by FROM sos_signals").fetchall()
    assert len(rows) == 1
    assert rows[0][0] == 1 and {"r1", "r2"} <= set(rows[0][1])


def test_only_help_and_safe_are_valid_sos_states(client):
    rec = sos(severity=2)
    assert sync(client, rec)["rejected"] == [{"event_id": rec["event_id"], "reason": "unknown_sos_status"}]


def test_a_phone_spamming_sos_is_rate_limited(client):
    out = sync(client, *[sos() for _ in range(mesh_module.MAX_SOS_PER_HOUR + 1)])
    assert len(out["acknowledged"]) == mesh_module.MAX_SOS_PER_HOUR
    assert out["rejected"][0]["reason"] == "rate_limited"


def test_reviewers_see_the_latest_call_per_sender_and_whether_they_said_safe(client):
    now = datetime.now(timezone.utc)
    ts = lambda minutes: int((now - timedelta(minutes=minutes)).timestamp())  # noqa: E731
    sync(
        client,
        sos(timestamp=ts(50)),                                   # first call from a1b2c3d4
        sos(timestamp=ts(40)),                                   # sent again
        sos(timestamp=ts(10), severity=0),                       # then: I'm safe
        sos(timestamp=ts(20), reporter_hash="0badf00d"),         # someone else, still needs help
    )
    r = client.get("/v1/review/sos")
    assert r.status_code == 200, r.text
    signals = r.json()
    assert [s["sender"] for s in signals] == ["0badf00d", "a1b2c3d4"]   # newest call first
    assert signals[0]["safe_at"] is None
    assert signals[1]["help_count"] == 2 and signals[1]["safe_at"] is not None
