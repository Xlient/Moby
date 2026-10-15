"""Worker SQL (migration 0018): leases, retries, poison messages, fusion locking.

These test the distributed guarantees with real concurrent connections and threads:
two workers never get the same report; a crashed worker's reports come back; a report
that keeps failing stops being retried; concurrent reports of one flood make one event.
"""
import threading
import time
from datetime import timedelta

import psycopg

from moby.graph import queries as q

from .test_graph_queries import conn, db_url, seeded  # noqa: F401 (fixtures)


def pending_count(conn) -> int:  # noqa: F811
    return conn.execute("SELECT count(*) FROM reports WHERE fusion_status = 'pending'").fetchone()[0]


def test_claim_returns_the_graph_report_shape(conn):  # noqa: F811
    seeded(conn, "lone_low")
    (report,) = q.claim_reports(conn, "worker-a", limit=10)
    assert isinstance(report["lat"], float) and isinstance(report["report_id"], str)
    assert report["attempts"] == 1
    assert conn.execute("SELECT claimed_by FROM reports").fetchone()[0] == "worker-a"


def test_a_claimed_report_is_not_claimed_again(conn):  # noqa: F811
    seeded(conn, "corroborated_flood")
    first = q.claim_reports(conn, "worker-a", limit=2)
    second = q.claim_reports(conn, "worker-b", limit=10)
    assert len(first) == 2 and len(second) == 1
    assert {r["report_id"] for r in first}.isdisjoint(r["report_id"] for r in second)
    assert q.claim_reports(conn, "worker-c", limit=10) == []          # everything is leased


def test_two_workers_claiming_at_the_same_instant_never_overlap(conn, db_url):  # noqa: F811
    seeded(conn, "corroborated_flood")
    seeded(conn, "same_person_thrice")
    # Worker A is mid-claim (its transaction is open, so it holds row locks)...
    with psycopg.connect(db_url) as a, psycopg.connect(db_url, autocommit=True) as b:
        got_a = q.claim_reports(a, "worker-a", limit=4)
        # ...worker B skips A's locked rows instead of waiting for them or taking them.
        got_b = q.claim_reports(b, "worker-b", limit=10)
        a.commit()
    assert len(got_a) == 4 and len(got_b) == 2
    assert {r["report_id"] for r in got_a}.isdisjoint(r["report_id"] for r in got_b)


def test_a_crashed_workers_reports_come_back_after_the_lease(conn):  # noqa: F811
    seeded(conn, "lone_low")
    q.claim_reports(conn, "worker-that-crashed", limit=10)
    assert q.claim_reports(conn, "worker-b", limit=10) == []
    conn.execute("UPDATE reports SET claimed_at = now() - %s", (q.LEASE + timedelta(seconds=1),))
    (again,) = q.claim_reports(conn, "worker-b", limit=10)
    assert again["attempts"] == 2


def test_failures_are_retried_then_given_up(conn):  # noqa: F811
    (report,) = seeded(conn, "lone_low")
    for attempt in range(1, q.MAX_ATTEMPTS + 1):
        conn.execute("UPDATE reports SET claimed_at = NULL")          # pretend the lease expired
        (claimed,) = q.claim_reports(conn, "worker-a", limit=1)
        assert claimed["attempts"] == attempt
        gave_up = q.report_failed(conn, report["report_id"], f"boom {attempt}")
        assert gave_up is (attempt == q.MAX_ATTEMPTS)
    status, error = conn.execute("SELECT fusion_status, fusion_error FROM reports").fetchone()
    assert status == "failed" and error == f"boom {q.MAX_ATTEMPTS}"
    conn.execute("UPDATE reports SET claimed_at = NULL")
    assert q.claim_reports(conn, "worker-a", limit=1) == []           # a poison message stays out


def test_report_failed_ignores_a_report_that_already_fused(conn):  # noqa: F811
    (report,) = seeded(conn, "lone_low")
    conn.execute("UPDATE reports SET fusion_status = 'fused'")
    assert q.report_failed(conn, report["report_id"], "late error") is False
    assert conn.execute("SELECT fusion_error FROM reports").fetchone()[0] is None


def test_fusion_lock_makes_concurrent_reports_of_one_flood_one_event(conn, db_url):  # noqa: F811
    reports = seeded(conn, "corroborated_flood")
    start = threading.Barrier(len(reports))
    errors = []

    def fuse_in_thread(report):
        try:
            with psycopg.connect(db_url) as c:                # one transaction, like the fuse node
                start.wait()                                  # all three start together
                q.lock_for_fusion(c, report)
                match = q.find_matching_event(c, report)
                time.sleep(0.05)                              # widen the race window on purpose
                event_id = match["event_id"] if match else q.create_event(c, report)
                q.attach_report(c, report["report_id"], event_id)
        except Exception as e:                                # surfaced below
            errors.append(e)

    threads = [threading.Thread(target=fuse_in_thread, args=(r,)) for r in reports]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    assert conn.execute("SELECT count(*) FROM events").fetchone()[0] == 1
    assert pending_count(conn) == 0
