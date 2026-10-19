"""Brief queue SQL (migration 0020): requests merge, claims are leased and debounced,
failures retry then give up."""
import json
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


# ── Evidence (Step 2) ───────────────────────────────────────────────────────

def test_evidence_for_a_corroborated_flood(conn):  # noqa: F811
    reports = seeded(conn, "corroborated_flood")
    eid = fuse_one(conn, reports[0])
    for r in reports[1:]:
        fuse_one(conn, r)
    facts = bq.event_facts(conn, eid)
    assert facts["event_id"] == eid and facts["source"] != "official"
    assert facts["reporters"] == 3 and facts["reports"] == 3
    assert isinstance(facts["lat"], float) and facts["area_km2"] is None   # community events have no area
    json.dumps(facts)                                                       # JSON-ready snapshot
    groups = bq.community_evidence(conn, eid)
    assert sum(g["reporters"] for g in groups) >= 3 and all(g["first_seen"] <= g["last_seen"] for g in groups)
    assert "note" not in json.dumps(groups)                                 # never the free text
    assert bq.previous_version(conn, eid) is None


def test_previous_version_is_the_latest(conn):  # noqa: F811
    eid = make_event(conn)
    for v in (1, 2):
        conn.execute("INSERT INTO brief_versions (event_id, version, facts, brief) VALUES (%s, %s, %s, %s)",
                     (eid, v, json.dumps({"v": v}), json.dumps({"summary": f"s{v}"})))
    prev = bq.previous_version(conn, eid)
    assert prev["version"] == 2 and prev["facts"] == {"v": 2}
    assert bq.event_facts(conn, "00000000-0000-0000-0000-000000000000") is None


def test_requested_at_identifies_the_request_not_the_attempt(conn):  # noqa: F811
    eid = make_event(conn)
    bq.request_brief(conn, eid)
    (first,) = bq.claim_brief_events(conn, "w", limit=5)
    conn.execute("UPDATE events SET brief_claimed_at = NULL")                   # crashed: claim again
    (retry,) = bq.claim_brief_events(conn, "w", limit=5)
    assert retry["brief_requested_at"] == first["brief_requested_at"]            # same run → resume
    conn.execute("UPDATE events SET brief_status = 'ready', brief_requested_at = now() - interval '1 hour'")
    bq.request_brief(conn, eid)
    (new,) = bq.claim_brief_events(conn, "w", limit=5)
    assert new["brief_requested_at"] != first["brief_requested_at"]              # new request → fresh run


# ── A finished run that didn't update the status ────────────────────────────

def test_settle_marks_ready_when_this_request_has_a_brief(conn):  # noqa: F811
    eid = make_event(conn)
    bq.request_brief(conn, eid)
    (claimed,) = bq.claim_brief_events(conn, "w", limit=5)
    add_brief(conn, eid, timedelta(0))                                 # saved, then the worker died
    assert bq.settle_finished_run(conn, eid, claimed["brief_requested_at"]) == "ready"
    assert bq.settle_finished_run(conn, eid, claimed["brief_requested_at"]) is None   # already settled


def test_settle_marks_failed_without_a_brief_for_this_request(conn):  # noqa: F811
    eid = make_event(conn)
    add_brief(conn, eid, timedelta(hours=2))                           # an OLD brief doesn't count
    bq.request_brief(conn, eid)
    (claimed,) = bq.claim_brief_events(conn, "w", limit=5)
    requested_at = claimed["brief_requested_at"]
    assert bq.settle_finished_run(conn, eid, requested_at) == "failed"
    assert conn.execute("SELECT brief_error FROM events").fetchone()[0] == "run finished without saving a brief"


def test_settle_leaves_a_newer_request_alone(conn):  # noqa: F811
    eid = make_event(conn)
    bq.request_brief(conn, eid)
    assert bq.settle_finished_run(conn, eid, "2000-01-01 00:00:00+00") is None
    assert status(conn, eid) == "pending"


# ── Saving a brief (Step 3) ─────────────────────────────────────────────────

BRIEF = {"summary": "People report rising water.", "uncertainty": "Unverified; 3 people.",
         "claims": [{"text": "Rising water reported.", "basis": "community", "evidence": ["C1"]}],
         "contradictions": [], "likely_progression": None, "official_guidance": None}
CITATIONS = [{"id": "C1", "title": "Rising water · 3 people", "kind": "community"}]


def claimed_request(conn, eid):  # noqa: F811
    bq.request_brief(conn, eid)
    (ev,) = bq.claim_brief_events(conn, "w", limit=5)
    return ev["brief_requested_at"], bq.event_facts(conn, eid)


def test_save_writes_brief_version_and_ready_together(conn):  # noqa: F811
    eid = make_event(conn)
    requested_at, facts = claimed_request(conn, eid)
    assert bq.save_brief(conn, eid, requested_at, brief=BRIEF, citations=CITATIONS, facts=facts, model="ultra") == 1
    assert status(conn, eid) == "ready"
    summary, claims, citations, sources, generated = conn.execute(
        "SELECT summary, claims, citations, sources, generated_at::text FROM briefs").fetchone()
    assert summary == BRIEF["summary"] and claims == BRIEF["claims"] and citations == CITATIONS
    assert sources == ["Rising water · 3 people"]
    assert generated == facts["evidence_as_of"]                    # as of when the evidence was read
    assert bq.previous_version(conn, eid)["facts"]["event_id"] == eid


def test_save_is_safe_to_repeat_and_versions_count_up(conn):  # noqa: F811
    eid = make_event(conn)
    requested_at, facts = claimed_request(conn, eid)
    bq.save_brief(conn, eid, requested_at, brief=BRIEF, citations=CITATIONS, facts=facts, model="ultra")
    # A resumed run repeats save_brief: nothing more is written.
    assert bq.save_brief(conn, eid, requested_at, brief=BRIEF, citations=CITATIONS, facts=facts, model="ultra") is None
    assert conn.execute("SELECT count(*) FROM brief_versions").fetchone()[0] == 1
    # A new request makes version 2, and the route's current brief is replaced.
    conn.execute("UPDATE briefs SET generated_at = now() - interval '1 hour'")
    requested_at, facts = claimed_request(conn, eid)
    assert bq.save_brief(conn, eid, requested_at, brief={**BRIEF, "summary": "v2"}, citations=CITATIONS,
                         facts=facts, model="ultra", changes="Two more people reported.") == 2
    assert conn.execute("SELECT version, summary, changes FROM briefs").fetchone() == (2, "v2", "Two more people reported.")


def test_a_saved_brief_settles_ready(conn):  # noqa: F811
    eid = make_event(conn)
    requested_at, facts = claimed_request(conn, eid)
    conn.execute("UPDATE events SET brief_status = 'pending'")      # as if READY never landed
    conn.execute("INSERT INTO briefs (event_id, generated_at, model, summary, uncertainty) "
                 "VALUES (%s, %s, 'm', 's', 'u')", (eid, facts["evidence_as_of"]))
    assert bq.settle_finished_run(conn, eid, requested_at) == "ready"


def test_facts_place_is_the_official_area_name(conn):  # noqa: F811
    eid = make_event(conn)
    assert bq.event_facts(conn, eid)["place"] is None                       # community event
    conn.execute("""UPDATE events SET source = 'official', source_feed = 'noaa', external_id = 'p',
                    raw_payload = '{"properties": {"areaDesc": "Sonoma; Marin"}, "big": "dropped"}'""")
    facts = bq.event_facts(conn, eid)
    assert facts["place"] == "Sonoma" and "raw_payload" not in facts
