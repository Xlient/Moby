"""Report → graph → delivery: the demo path, with a fake push sender instead of FCM.

Three people report rising water; each report runs through the real graph (fuse, score,
save, draft_alert); then the real delivery worker decides who gets a push.
"""
import asyncio

import psycopg
import pytest

from moby.config import get_settings
from moby.graph import run as harness

from .test_delivery import FakeSender, client, db_url, deliver, setup_device  # noqa: F401 (fixtures)
from .test_graph_queries import seeded

SPOT = {"lat": 37.8000, "lon": -122.4194}   # corroborated_flood in scripts/seed_reports.py


@pytest.fixture
def graph_db(client, db_url, monkeypatch):  # noqa: F811
    monkeypatch.setenv("DATABASE_URL", db_url)
    get_settings.cache_clear()
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events, reports, review_queue CASCADE")
        yield c
    get_settings.cache_clear()


def run_graph_once(report_id: str) -> dict:
    from moby.graph.pipeline import build_graph
    report = harness.fetch_report(report_id)
    return asyncio.run(harness.run(build_graph, state={"report": report}, thread_id=f"report-{report_id}"))


def test_three_reports_become_one_unverified_push(client, db_url, graph_db):  # noqa: F811
    setup_device(client, db_url, near_me=False)
    assert client.put("/v1/me/near-me", json={"center": SPOT, "radius_km": 5}).status_code == 204
    reports = seeded(graph_db, "corroborated_flood")

    first = run_graph_once(reports[0]["report_id"])
    assert first["tier"] == 0 and first["alert_headline"] == "Rising water reported"
    sender = FakeSender()
    assert deliver(db_url, sender)["sent"] == 0          # one person: only for people who chose single reports

    run_graph_once(reports[1]["report_id"])
    final = run_graph_once(reports[2]["report_id"])
    assert final["tier"] == 1 and final["distinct_reporters"] == 3

    assert deliver(db_url, sender)["sent"] == 1          # 2+ people: the default choice gets it
    push = sender.pushes[0]
    assert push.title == "Unverified: Rising water reported"
    assert push.body.startswith("Reported by 3 people nearby, not confirmed by officials.")
    assert "dangerous" in push.body and "moving water" in push.body

    alert = client.get(f"/v1/alerts/{final['event_id']}").json()
    assert alert["headline"] == "Rising water reported" and alert["verification_label"] == "corroborated_report"


def test_a_report_near_an_official_warning_sends_nothing_new(client, db_url, graph_db):  # noqa: F811
    (report,) = seeded(graph_db, "near_official")
    final = run_graph_once(report["report_id"])
    assert final["official_match"] is True and "alert_headline" not in final   # the path ended before draft_alert
