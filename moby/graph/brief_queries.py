"""SQL for the situational brief queue (migration 0020). Plain functions: a connection in,
plain values out. Briefs explain events; nothing here touches tier, severity or delivery.

How the queue works:
  * request_brief marks an event pending. Asking again while it's already pending changes
    nothing, so a burst of reports or feed updates becomes ONE request.
  * claim_brief_events leases pending events to a worker (same lease idea as the fusion
    worker in queries.py), most severe first. Two rules keep Ultra spend down:
      - debounce: an event whose current brief is younger than DEBOUNCE waits until it isn't,
        so updates that arrive meanwhile are covered by one rewrite instead of several;
      - expired official warnings aren't briefed at all.
  * brief_failed records an error; after MAX_ATTEMPTS the event is marked 'failed'.
  * Briefs are written when someone looks (decided 2026-10-18): opening an event asks for
    one (VIEW_SQL, from GET /v1/events/{id}/brief). The stored brief is then served to every
    reader, so one Ultra call covers everyone until new reports make it out of date. The one
    automatic trigger is new or changed CRITICAL official warnings, in the poller's upsert
    (moby/feeds/poller.py): they are pushed widely, so their brief should be ready on tap.
    request_brief stays for callers that want a brief regardless (scripts, tests).
"""

import json
from datetime import timedelta
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row

DEBOUNCE = timedelta(minutes=30)  # min time between two briefs of one event
LEASE = timedelta(minutes=5)      # a claim older than this is presumed dead and re-claimable
MAX_ATTEMPTS = 2                  # one retry, then brief_status = 'failed' (saves the daily cap)

# Already pending → no change (keeps brief_requested_at, so the event doesn't lose its place).
REQUEST_SQL = """
UPDATE events
SET brief_status = 'pending', brief_requested_at = now(),
    brief_attempts = 0, brief_error = NULL, brief_claimed_at = NULL, brief_claimed_by = NULL
WHERE event_id = %(event_id)s AND brief_status <> 'pending'
"""

# Opening an event asks for a brief when there's something new to explain: a community report
# that arrived after the last brief (or the last request, so a brief that failed isn't retried
# on every view). Only official events and corroborated community events (tier 1: 2+ people;
# community events never reach tier 2, which takes an official match): a lone unverified
# report isn't worth an Ultra call. Expired warnings never. The claim's debounce still applies, so a
# view right after a brief queues the rewrite for later instead of paying twice.
VIEW_SQL = """
UPDATE events e
SET brief_status = 'pending', brief_requested_at = now(),
    brief_attempts = 0, brief_error = NULL, brief_claimed_at = NULL, brief_claimed_by = NULL
WHERE e.event_id = %(event_id)s
  AND e.brief_status <> 'pending'
  AND (e.source = 'official' OR e.tier >= 1)
  AND (e.expires_at IS NULL OR e.expires_at > now())
  AND EXISTS (
      SELECT 1 FROM reports r
      WHERE r.event_id = e.event_id
        AND r.received_at > COALESCE(
            GREATEST((SELECT b.generated_at FROM briefs b WHERE b.event_id = e.event_id), e.brief_requested_at),
            '-infinity'))
"""

# Like the fusion worker's CLAIM_SQL: SKIP LOCKED so workers never share or wait on a row.
CLAIM_SQL = """
WITH next AS (
    SELECT e.event_id FROM events e
    LEFT JOIN briefs b USING (event_id)
    WHERE e.brief_status = 'pending'
      AND e.brief_attempts < %(max_attempts)s
      AND (e.brief_claimed_at IS NULL OR e.brief_claimed_at < now() - %(lease)s)
      AND (b.generated_at IS NULL OR b.generated_at < now() - %(debounce)s)
      AND (e.expires_at IS NULL OR e.expires_at > now())
    ORDER BY CASE e.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             e.brief_requested_at
    LIMIT %(limit)s
    FOR UPDATE OF e SKIP LOCKED
)
UPDATE events e
SET brief_claimed_at = now(), brief_claimed_by = %(worker_id)s, brief_attempts = e.brief_attempts + 1
FROM next WHERE e.event_id = next.event_id
RETURNING e.event_id, e.source, e.hazard_type, e.severity, e.tier, e.country, e.brief_attempts
"""

FAILED_SQL = """
UPDATE events
SET brief_error = left(%(error)s, 500),
    brief_status = CASE WHEN brief_attempts >= %(max_attempts)s THEN 'failed' ELSE brief_status END
WHERE event_id = %(event_id)s AND brief_status = 'pending'
RETURNING brief_status = 'failed'
"""


def request_brief(conn: Connection, event_id: str) -> bool:
    """Ask for a (new) brief of this event. True if it is newly pending; False if it was
    already pending (the request merges with that one). Safe to call on every run."""
    return conn.execute(REQUEST_SQL, {"event_id": event_id}).rowcount == 1


def request_brief_on_view(conn: Connection, event_id: str) -> bool:
    """Someone opened this event: ask for a brief if there are reports it doesn't cover yet
    (see VIEW_SQL). True if it is newly pending. The API runs the same SQL asynchronously."""
    return conn.execute(VIEW_SQL, {"event_id": event_id}).rowcount == 1


def claim_brief_events(conn: Connection, worker_id: str, limit: int) -> list[dict[str, Any]]:
    """Lease up to `limit` pending events to this worker, most severe first. Ids come back as
    strings. The caller must COMMIT for the claim to take effect (an autocommit connection does)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(CLAIM_SQL, {"worker_id": worker_id, "limit": limit, "lease": LEASE,
                                "debounce": DEBOUNCE, "max_attempts": MAX_ATTEMPTS})
        rows = cur.fetchall()
    return [json.loads(json.dumps(r, default=str)) for r in rows]


def brief_failed(conn: Connection, event_id: str, error: str) -> bool:
    """Record a failed brief run. True when the event is out of attempts and now 'failed';
    False when it will be retried after its lease expires."""
    row = conn.execute(FAILED_SQL, {"event_id": event_id, "error": error,
                                    "max_attempts": MAX_ATTEMPTS}).fetchone()
    return bool(row and row[0])
