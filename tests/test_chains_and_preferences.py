"""NOAA alert chains, official tiers and alert preferences.

Pure-logic tests always run. The `db` tests use a throwaway `moby_test` database
on the same server as DATABASE_URL (created and migrated on first use) and are
skipped when Postgres isn't reachable:

    docker compose up -d && uv run pytest
"""
import asyncio
import copy
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
import pytest

from moby.alerts.preferences import ALL_HAZARDS, AlertPreferences, alerts_near
from moby.escalation.official import official_verification
from moby.feeds import noaa
from moby.feeds.poller import apply_cancels, group_chains, known_chain_ids, reconcile, upsert_events
from moby.feeds.schema import NormalizedEvent

ROOT = Path(__file__).resolve().parent.parent
T0 = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


def nws(item_id: str, *, sent: datetime = T0, refs=(), cancel=False, severity="Moderate",
        event="Flood Warning", lat=38.6, lon=-92.2, ugc=("MOC051",)) -> NormalizedEvent:
    """A minimal NWS alert feature run through the real normalizer."""
    feature = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "id": item_id, "status": "Actual", "event": event, "severity": severity,
            "messageType": "Cancel" if cancel else ("Update" if refs else "Alert"),
            "sent": sent.isoformat(), "expires": (sent + timedelta(hours=6)).isoformat(),
            "headline": f"{event} {item_id}", "geocode": {"UGC": list(ugc)},
            "references": [{"identifier": r} for r in refs], "affectedZones": [],
        },
    }
    (ev,) = noaa.normalize({"features": [feature]}).events
    return ev


# ── Pure logic ───────────────────────────────────────────────────────────────

def test_update_in_same_poll_joins_the_original_chain():
    rows, cancels = group_chains([nws("B", sent=T0 + timedelta(hours=1), refs=["A"]), nws("A")], known={})
    assert not cancels
    assert len(rows) == 1
    assert rows[0].event.external_id == "A"               # chain key = first id
    assert rows[0].item_ids == ["A", "B"]                  # oldest first
    assert rows[0].event.raw_payload["properties"]["id"] == "B"  # newest content wins


def test_update_links_to_a_chain_already_in_the_database():
    rows, _ = group_chains([nws("C", refs=["B"])], known={"A": "A", "B": "A"})
    assert rows[0].event.external_id == "A" and rows[0].item_ids == ["C"]


def test_cancel_is_routed_to_its_chain_not_upserted():
    rows, cancels = group_chains([nws("X", refs=["B"], cancel=True)], known={"A": "A", "B": "A"})
    assert rows == [] and [c.external_id for c in cancels] == ["A"]


def test_unrelated_alerts_stay_separate():
    rows, _ = group_chains([nws("A"), nws("Z")], known={})
    assert sorted(r.event.external_id for r in rows) == ["A", "Z"]


def test_marine_by_product_and_by_zone():
    assert nws("M1", event="Small Craft Advisory").marine
    assert nws("M2", event="Dense Fog Advisory", ugc=("PZZ210", "PZZ251")).marine   # all-marine zones
    assert not nws("L1", event="Dense Fog Advisory", ugc=("CAZ006",)).marine
    assert not nws("C1", event="Rip Current Statement", ugc=("FLZ168",)).marine    # shore, not sea


def test_official_tier_policy():
    assert official_verification(nws("A")).tier == 2
    eonet_like = copy.copy(nws("A")); eonet_like.source_feed = "eonet"
    assert official_verification(eonet_like).tier == 1


def test_preferences_defaults_and_parsing():
    p = AlertPreferences()
    assert p.hazard_types == ALL_HAZARDS and p.min_severity == "low" and not p.include_marine
    assert not p.matches("storm", "high", marine=True)
    assert AlertPreferences(include_marine=True).matches("storm", "high", marine=True)
    q = AlertPreferences.from_dict({"hazard_types": ["flood", "bogus"], "min_severity": "high"})
    assert q.hazard_types == {"flood"} and q.allowed_severities() == ["high", "critical"]
    # An empty selection must never silence everything.
    assert AlertPreferences.from_dict({"hazard_types": []}).hazard_types == ALL_HAZARDS
    assert AlertPreferences.from_dict(q.to_dict()) == q


def test_critical_alerts_bypass_every_preference():
    strict = AlertPreferences(hazard_types=frozenset({"fire"}), min_severity="critical", include_marine=False)
    assert strict.matches("flood", "critical", marine=False)      # hazard type turned off
    assert strict.matches("storm", "critical", marine=True)       # marine turned off
    assert not strict.matches("flood", "high", marine=False)      # lesser alerts still filtered


# ── Database ─────────────────────────────────────────────────────────────────

def _test_db_url() -> str | None:
    base = os.environ.get("DATABASE_URL") or "postgresql://moby:moby@localhost:5432/moby"
    u = urlparse(base)
    try:
        with psycopg.connect(base, autocommit=True, connect_timeout=2) as c:
            if not c.execute("SELECT 1 FROM pg_database WHERE datname = 'moby_test'").fetchone():
                c.execute("CREATE DATABASE moby_test")
    except psycopg.OperationalError:
        return None
    url = urlunparse(u._replace(path="/moby_test"))
    env = {**os.environ, "DATABASE_URL": url}
    subprocess.run([sys.executable, str(ROOT / "scripts" / "migrate.py")], env=env, check=True, capture_output=True)
    return url


@pytest.fixture(scope="module")
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    return url


def run(db_url, fn):
    async def go():
        async with await psycopg.AsyncConnection.connect(db_url) as conn:
            await conn.execute("TRUNCATE events CASCADE")
            return await fn(conn)
    return asyncio.run(go())


async def ingest(conn, events, *, snapshot=True):
    active = [e.external_id for e in events if not e.cancels]
    known = await known_chain_ids(conn, "noaa", events)
    rows, cancels = group_chains(events, known)
    await upsert_events(conn, rows)
    await apply_cancels(conn, "noaa", cancels)
    if snapshot:
        await reconcile(conn, "noaa", active)


async def fetch(conn, sql, *args):
    return await (await conn.execute(sql, args)).fetchall()


def test_db_update_keeps_one_row_and_stable_event_id(db_url):
    async def scenario(conn):
        await ingest(conn, [nws("A")])
        (eid1,), = await fetch(conn, "SELECT event_id FROM events")
        # Next poll: NWS replaced A with B (A no longer listed).
        await ingest(conn, [nws("B", sent=T0 + timedelta(hours=1), refs=["A"], severity="Severe")])
        return eid1, await fetch(conn, "SELECT event_id, external_id, feed_item_ids, severity, expires_at > now() FROM events")
    eid1, rows = run(db_url, scenario)
    assert len(rows) == 1
    eid, ext, items, severity, active = rows[0]
    assert eid == eid1 and ext == "A" and items == ["A", "B"]
    assert severity == "high" and active is not False


def test_db_cancel_expires_the_chain(db_url):
    async def scenario(conn):
        await ingest(conn, [nws("A", sent=datetime.now(timezone.utc))])
        await ingest(conn, [nws("C", sent=datetime.now(timezone.utc), refs=["A"], cancel=True)], snapshot=False)
        return await fetch(conn, "SELECT feed_item_ids, expires_at <= now() FROM events")
    (items, expired), = run(db_url, scenario)
    assert items == ["A", "C"] and expired


def test_db_reappearing_alert_is_restored(db_url):
    async def scenario(conn):
        future = datetime.now(timezone.utc)
        a = nws("A", sent=future)
        await ingest(conn, [a])
        await ingest(conn, [])          # partial/empty snapshot wrongly ends it
        mid = await fetch(conn, "SELECT expires_at <= now() FROM events")
        await ingest(conn, [nws("A", sent=future)])
        return mid, await fetch(conn, "SELECT expires_at > now() FROM events")
    (mid,), (after,) = run(db_url, scenario)
    assert mid == (True,) and after == (True,)


def test_db_tier_set_on_insert_and_never_lowered(db_url):
    async def scenario(conn):
        await ingest(conn, [nws("A")])
        t1 = await fetch(conn, "SELECT tier, confidence FROM events")
        await conn.execute("UPDATE events SET tier = 2, reviewer_decision = 'hold'")
        await ingest(conn, [nws("B", sent=T0 + timedelta(hours=1), refs=["A"])])
        return t1, await fetch(conn, "SELECT tier, reviewer_decision FROM events")
    (t1,), (t2,) = run(db_url, scenario)
    assert t1[0] == 2 and abs(t1[1] - 0.95) < 1e-6
    assert t2 == (2, "hold")


def test_db_alerts_near_applies_preferences(db_url):
    now = datetime.now(timezone.utc)

    async def scenario(conn):
        await ingest(conn, [
            nws("flood", sent=now, severity="Severe", lat=37.80, lon=-122.40),
            nws("heat", sent=now, event="Heat Advisory", severity="Minor", lat=37.75, lon=-122.45),
            nws("boat", sent=now, event="Small Craft Advisory", severity="Moderate", lat=37.70, lon=-122.60),
            nws("far", sent=now, severity="Extreme", lat=40.0, lon=-120.0),
            nws("quake", sent=now, event="Earthquake Warning", severity="Extreme", lat=37.78, lon=-122.41),
        ])
        default = await alerts_near(conn, 37.77, -122.42, 50)
        marine = await alerts_near(conn, 37.77, -122.42, 50, AlertPreferences(include_marine=True))
        floods_high = await alerts_near(conn, 37.77, -122.42, 50,
                                        AlertPreferences(hazard_types=frozenset({"flood"}), min_severity="high"))
        return [[r["external_id"] for r in rows] for rows in (default, marine, floods_high)]

    default, marine, floods_high = run(db_url, scenario)
    assert default == ["quake", "flood", "heat"]   # severity order; marine hidden; far excluded
    assert set(marine) == {"quake", "flood", "heat", "boat"}
    # Earthquakes are filtered out here, but a critical one still gets through.
    assert floods_high == ["quake", "flood"]
