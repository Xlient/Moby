"""Brief queue SQL (migration 0020): requests merge, claims are leased and debounced,
failures retry then give up."""
from datetime import timedelta

import psycopg

from moby.graph import brief_queries as bq

from .test_graph_queries import conn, db_url, fuse_one, seeded  # noqa: F401 (fixtures)


def make_event(conn, scenario: str = "lone_low", severity: str = "medium") -> str:  # noqa: F811
    (report,) = seeded(conn, scenario)[:1]
    event_id = fuse_one(conn, report)
    conn.execute("UPDATE events SET severity = %s WHERE event_id = %s", (severity, event_id))
    return event_id


def status(conn, event_id: str) -> str:  # noqa: F811
    return conn.execute("SELECT brief_status FROM events WHERE event_id = %s", (event_id,)).fetchone()[0]


def add_brief(conn, event_id: str, age: timedelta) -> None:  # noqa: F811
    conn.execute("INSERT INTO briefs (event_id, generated_at, model, summary, uncertainty) "
                 "VALUES (%s, now() - %s, 'm', 's', 'u')", (event_id, age))


def test_requests_merge_while_pending(conn):  # noqa: F811
    eid = make_event(conn)
    assert bq.request_brief(conn, eid) is True
    first = conn.execute("SELECT brief_requested_at FROM events").fetchone()[0]
    assert bq.request_brief(conn, eid) is False                       # merged with the first
    assert conn.execute("SELECT brief_requested_at FROM events").fetchone()[0] == first
    assert status(conn, eid) == "pending"


def test_claim_leases_most_severe_first(conn):  # noqa: F811
    low = make_event(conn, "lone_low", "low")
    crit = make_event(conn, "same_person_thrice", "critical")
    bq.request_brief(conn, low)
    bq.request_brief(conn, crit)
    got = bq.claim_brief_events(conn, "w1", limit=1)
    assert [e["event_id"] for e in got] == [crit] and got[0]["brief_attempts"] == 1
    assert [e["event_id"] for e in bq.claim_brief_events(conn, "w2", limit=5)] == [low]
    assert bq.claim_brief_events(conn, "w3", limit=5) == []           # both leased


def test_two_workers_never_share_an_event(conn, db_url):  # noqa: F811
    eid = make_event(conn)
    bq.request_brief(conn, eid)
    with psycopg.connect(db_url) as a, psycopg.connect(db_url, autocommit=True) as b:
        got_a = bq.claim_brief_events(a, "a", limit=5)
        got_b = bq.claim_brief_events(b, "b", limit=5)
        a.commit()
    assert len(got_a) == 1 and got_b == []


def test_a_recent_brief_debounces_the_next_one(conn):  # noqa: F811
    eid = make_event(conn)
    add_brief(conn, eid, timedelta(minutes=10))
    bq.request_brief(conn, eid)
    assert bq.claim_brief_events(conn, "w", limit=5) == []            # waits, stays pending
    assert status(conn, eid) == "pending"
    conn.execute("UPDATE briefs SET generated_at = now() - %s", (bq.DEBOUNCE + timedelta(seconds=1),))
    assert len(bq.claim_brief_events(conn, "w", limit=5)) == 1


def test_expired_events_are_not_briefed(conn):  # noqa: F811
    eid = make_event(conn)
    conn.execute("UPDATE events SET expires_at = now() - interval '1 minute'")
    bq.request_brief(conn, eid)
    assert bq.claim_brief_events(conn, "w", limit=5) == []


def test_a_crashed_workers_claim_comes_back_after_the_lease(conn):  # noqa: F811
    eid = make_event(conn)
    bq.request_brief(conn, eid)
    bq.claim_brief_events(conn, "crashed", limit=5)
    assert bq.claim_brief_events(conn, "w", limit=5) == []
    conn.execute("UPDATE events SET brief_claimed_at = now() - %s", (bq.LEASE + timedelta(seconds=1),))
    (again,) = bq.claim_brief_events(conn, "w", limit=5)
    assert again["brief_attempts"] == 2


def test_failures_retry_then_give_up(conn):  # noqa: F811
    eid = make_event(conn)
    bq.request_brief(conn, eid)
    for attempt in range(1, bq.MAX_ATTEMPTS + 1):
        conn.execute("UPDATE events SET brief_claimed_at = NULL")       # lease "expired"
        assert len(bq.claim_brief_events(conn, "w", limit=5)) == 1
        gave_up = bq.brief_failed(conn, eid, f"boom {attempt}")
        assert gave_up is (attempt == bq.MAX_ATTEMPTS)
    assert status(conn, eid) == "failed"
    assert bq.request_brief(conn, eid) is True                         # a new request starts over
    assert conn.execute("SELECT brief_attempts, brief_error FROM events").fetchone() == (0, None)


# ── Opening an event (VIEW_SQL) ─────────────────────────────────────────────

def test_view_asks_for_a_first_brief_of_a_corroborated_event(conn):  # noqa: F811
    lone = make_event(conn, "lone_low")
    assert bq.request_brief_on_view(conn, lone) is False              # tier 0, one person: not worth Ultra
    conn.execute("UPDATE events SET tier = 1 WHERE event_id = %s", (lone,))
    assert bq.request_brief_on_view(conn, lone) is True
    assert bq.request_brief_on_view(conn, lone) is False              # already pending


def test_view_rewrites_only_for_reports_newer_than_the_brief(conn):  # noqa: F811
    eid = make_event(conn, "lone_low")
    conn.execute("UPDATE events SET tier = 1, brief_status = 'ready'")
    add_brief(conn, eid, timedelta(minutes=0))                         # covers every report so far
    assert bq.request_brief_on_view(conn, eid) is False
    conn.execute("UPDATE reports SET received_at = now() + interval '1 second'")   # a newer report
    assert bq.request_brief_on_view(conn, eid) is True


def test_view_doesnt_retry_a_failed_brief_without_new_reports(conn):  # noqa: F811
    eid = make_event(conn, "lone_low")
    conn.execute("UPDATE events SET tier = 1")
    bq.request_brief_on_view(conn, eid)
    conn.execute("UPDATE events SET brief_status = 'failed'")
    assert bq.request_brief_on_view(conn, eid) is False


def test_view_ignores_expired_warnings(conn):  # noqa: F811
    eid = make_event(conn, "lone_low")
    conn.execute("UPDATE events SET tier = 1, expires_at = now() - interval '1 minute'")
    assert bq.request_brief_on_view(conn, eid) is False
