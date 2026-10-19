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
from psycopg.types.json import Jsonb

from moby.geo import country_at

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
RETURNING e.event_id, e.source, e.hazard_type, e.severity, e.tier, e.country, e.brief_attempts,
          e.brief_requested_at
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
    """Lease up to `limit` pending events to this worker, most severe first. Ids and times come
    back as strings. The caller must COMMIT for the claim to take effect (an autocommit
    connection does).

    `brief_requested_at` identifies the REQUEST: set when a brief is asked for, untouched by
    claims and retries, new on the next request. Use it in the checkpointer's thread id, so a
    retry after a crash resumes its run and a new request starts a fresh one."""
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


# A claimed request whose graph run already reached END (its checkpoint says so) but is still
# 'pending': settle it from what's in the database instead of running (and paying) again.
# A brief saved for this request → 'ready'; none → 'failed' with a note. Only this request:
# a newer request (different brief_requested_at) is left alone.
SETTLE_SQL = """
UPDATE events e
SET brief_status = CASE WHEN b.generated_at >= e.brief_requested_at THEN 'ready' ELSE 'failed' END,
    brief_error  = CASE WHEN b.generated_at >= e.brief_requested_at THEN NULL
                        ELSE 'run finished without saving a brief' END,
    brief_claimed_at = NULL, brief_claimed_by = NULL
FROM events e0 LEFT JOIN briefs b ON b.event_id = e0.event_id
WHERE e.event_id = %(event_id)s AND e0.event_id = e.event_id
  AND e.brief_status = 'pending' AND e.brief_requested_at = %(requested_at)s::timestamptz
RETURNING e.brief_status
"""


def settle_finished_run(conn: Connection, event_id: str, requested_at: str) -> str | None:
    """The worker found this request's run already finished: mark the event 'ready' if a brief
    was saved for the request, else 'failed'. Returns the new status, or None if the event isn't
    pending for that request any more (nothing to do)."""
    row = conn.execute(SETTLE_SQL, {"event_id": event_id, "requested_at": requested_at}).fetchone()
    return row[0] if row else None


# ── Evidence for a brief (Step 2: gather_evidence) ───────────────────────────────────────
#
# What the brief may say comes only from these rows. No reporter notes or identities: the
# community side is grouped by what people saw, with Nano's structured details (schemas.py,
# no free text). `event_facts` is also the snapshot saved with each brief (brief_versions.facts)
# that the next brief diffs against for "what changed", so every value is JSON-ready.

FACTS_SQL = """
SELECT now()::text AS evidence_as_of,          -- when this evidence was read (see save_brief); not a fact to diff
       e.event_id::text, e.source, e.source_feed, e.hazard_type, e.product, e.severity, e.tier,
       e.country, e.region,
       COALESCE(e.title_en, e.title) AS title, COALESCE(e.description_en, e.description) AS description,
       e.first_reported_at::text, e.last_updated_at::text, e.expires_at::text,
       ST_Y(e.location::geometry) AS lat, ST_X(e.location::geometry) AS lon,
       round((ST_Area(e.area) / 1e6)::numeric, 1)::float AS area_km2,
       e.reports_disagree,
       jsonb_build_object('properties', e.raw_payload->'properties') AS raw_payload,   -- for `place`; removed after
       (SELECT count(DISTINCT r.reporter_hash) FROM reports r WHERE r.event_id = e.event_id)::int AS reporters,
       (SELECT count(*) FROM reports r WHERE r.event_id = e.event_id)::int AS reports
FROM events e WHERE e.event_id = %(event_id)s
"""

COMMUNITY_SQL = """
SELECT COALESCE(r.observed_effect, 'unspecified') AS effect,
       count(DISTINCT r.reporter_hash)::int AS reporters,
       count(*)::int AS reports,
       min(r.observed_at)::text AS first_seen,
       max(r.observed_at)::text AS last_seen,
       array_agg(DISTINCT r.severity) AS severities,
       COALESCE(jsonb_agg(r.structured ORDER BY r.observed_at)
                FILTER (WHERE r.structured IS NOT NULL AND r.structured <> '{}'::jsonb), '[]'::jsonb) AS details
FROM reports r
WHERE r.event_id = %(event_id)s
GROUP BY 1
ORDER BY reporters DESC, last_seen DESC
"""

PREVIOUS_SQL = """
SELECT version, created_at::text, facts, brief
FROM brief_versions WHERE event_id = %(event_id)s
ORDER BY version DESC LIMIT 1
"""


def event_facts(conn: Connection, event_id: str) -> dict[str, Any] | None:
    """The event as the brief sees it (official wording in English when translated), plus
    area in km², reporter counts and `place`: the official area's name as the app shows it
    (e.g. "Solukhumbu"), or None for community events and feeds without one. A missing
    country is worked out from the position, offline. None if the event doesn't exist."""
    from moby.api.alerts import _location_name   # same place name the app shows
    with conn.cursor(row_factory=dict_row) as cur:
        facts = cur.execute(FACTS_SQL, {"event_id": event_id}).fetchone()
    if facts is None:
        return None
    facts["place"] = _location_name(facts) if facts["source_feed"] else None
    del facts["raw_payload"]
    if not facts["country"] and facts["lat"] is not None:
        # Community events have no country: work it out locally from the position (moby/geo.py).
        facts["country"] = country_at(facts["lat"], facts["lon"])
    return facts


def community_evidence(conn: Connection, event_id: str) -> list[dict[str, Any]]:
    """Reports attached to the event, one group per thing people saw ("rising water",
    "blocked road"...): distinct reporters, when, severities, structured details. Biggest first."""
    with conn.cursor(row_factory=dict_row) as cur:
        return cur.execute(COMMUNITY_SQL, {"event_id": event_id}).fetchall()


def previous_version(conn: Connection, event_id: str) -> dict[str, Any] | None:
    """The latest saved brief and the facts it was written from, or None for a first brief."""
    with conn.cursor(row_factory=dict_row) as cur:
        return cur.execute(PREVIOUS_SQL, {"event_id": event_id}).fetchone()



# ── Saving a brief (Step 3: save_brief) ──────────────────────────────────────────────────
#
# One transaction: the brief, its version (with the facts snapshot "what changed" diffs next
# time) and brief_status = 'ready' are written together or not at all, so a crash can never
# leave a saved brief on a 'pending' event (or a 'ready' event without its brief).
#
# Only for the request that was claimed: if the event isn't pending for `requested_at` any
# more (already saved by an earlier attempt, or settled), nothing is written and None comes
# back. That makes the node safe to repeat when a run resumes after a crash.
#
# generated_at is set to when the evidence was READ, not when the model finished: a report
# that arrives while Ultra is writing isn't in this brief, and the view rule (reports newer
# than generated_at) then correctly asks for a rewrite.

LOCK_REQUEST_SQL = """
SELECT 1 FROM events
WHERE event_id = %(event_id)s AND brief_status = 'pending' AND brief_requested_at = %(requested_at)s::timestamptz
FOR UPDATE
"""

NEXT_VERSION_SQL = "SELECT COALESCE(max(version), 0) + 1 FROM brief_versions WHERE event_id = %(event_id)s"

UPSERT_BRIEF_SQL = """
INSERT INTO briefs (event_id, generated_at, model, summary, likely_progression, official_guidance,
                    uncertainty, sources, version, claims, contradictions, citations, changes, changes_since)
VALUES (%(event_id)s, %(generated_at)s::timestamptz, %(model)s, %(summary)s, %(likely_progression)s,
        %(official_guidance)s, %(uncertainty)s, %(sources)s, %(version)s, %(claims)s, %(contradictions)s,
        %(citations)s, %(changes)s, %(changes_since)s::timestamptz)
ON CONFLICT (event_id) DO UPDATE SET
    generated_at = EXCLUDED.generated_at, model = EXCLUDED.model, summary = EXCLUDED.summary,
    likely_progression = EXCLUDED.likely_progression, official_guidance = EXCLUDED.official_guidance,
    uncertainty = EXCLUDED.uncertainty, sources = EXCLUDED.sources, version = EXCLUDED.version,
    claims = EXCLUDED.claims, contradictions = EXCLUDED.contradictions, citations = EXCLUDED.citations,
    changes = EXCLUDED.changes, changes_since = EXCLUDED.changes_since
"""

INSERT_VERSION_SQL = """
INSERT INTO brief_versions (event_id, version, facts, brief)
VALUES (%(event_id)s, %(version)s, %(facts)s, %(brief)s)
"""

READY_SQL = """
UPDATE events SET brief_status = 'ready', brief_error = NULL, brief_claimed_at = NULL, brief_claimed_by = NULL
WHERE event_id = %(event_id)s
"""


def save_brief(conn: Connection, event_id: str, requested_at: str, *, brief: dict[str, Any],
               citations: list[dict[str, Any]], facts: dict[str, Any], model: str,
               changes: str | None = None, changes_since: str | None = None) -> int | None:
    """Save a brief for the claimed request and mark the event 'ready', all in one transaction.

    brief:     BriefDraft.to_saved() (summary, claims, contradictions, likely_progression,
               official_guidance, uncertainty)
    citations: the evidence items the brief may cite, as the app shows them: [{id, title, kind, url?}]
    facts:     event_facts() as gathered for this brief (its evidence_as_of becomes generated_at)
    Returns the new version number, or None if the request isn't pending any more (nothing written).
    """
    with conn.transaction():
        if conn.execute(LOCK_REQUEST_SQL, {"event_id": event_id, "requested_at": requested_at}).fetchone() is None:
            return None
        (version,) = conn.execute(NEXT_VERSION_SQL, {"event_id": event_id}).fetchone()
        sources = [c.get("url") or c["title"] for c in citations]
        conn.execute(UPSERT_BRIEF_SQL, {
            "event_id": event_id, "generated_at": facts["evidence_as_of"], "model": model,
            "summary": brief["summary"], "likely_progression": brief.get("likely_progression"),
            "official_guidance": brief.get("official_guidance"), "uncertainty": brief["uncertainty"],
            "sources": Jsonb(sources), "version": version, "claims": Jsonb(brief["claims"]),
            "contradictions": Jsonb(brief.get("contradictions") or []), "citations": Jsonb(citations),
            "changes": changes, "changes_since": changes_since,
        })
        conn.execute(INSERT_VERSION_SQL, {
            "event_id": event_id, "version": version, "facts": Jsonb(facts),
            "brief": Jsonb({**brief, "citations": citations, "model": model, "changes": changes}),
        })
        conn.execute(READY_SQL, {"event_id": event_id})
    return version


# ── Timeline for the app (GET /v1/events/{id}/brief) ─────────────────────────────────────
#
# Built from the database when the brief is read, not by the model: code decides what's on
# the timeline, so it's always current. Entries newer than the brief are flagged after_brief,
# so the app can show "new since this brief".

TIMELINE_EVENT_SQL = """
SELECT source, source_feed, product, COALESCE(title_en, title) AS title,
       first_reported_at, last_updated_at, expires_at
FROM events WHERE event_id = %(event_id)s
"""

TIMELINE_REPORTS_SQL = """
SELECT COALESCE(observed_effect, 'unspecified') AS effect,
       count(DISTINCT reporter_hash)::int AS reporters,
       min(observed_at) AS first_seen, max(observed_at) AS last_seen,
       (array_agg(observed_at ORDER BY observed_at))[1:20] AS times,
       array_agg(DISTINCT severity) AS severities
FROM reports WHERE event_id = %(event_id)s
GROUP BY 1
"""

_SEVERITY = ["low", "medium", "high", "critical"]


def build_timeline(event: dict[str, Any] | None, groups: list[dict[str, Any]], *,
                   attribution: dict[str, str], generated_at=None) -> list[dict[str, Any]]:
    """Timeline entries, oldest first: the official warning (issued, updated, in force until)
    and one entry per thing people reported (first to last report, with each report's time)."""
    def iso(t):
        return t.isoformat() if t else None

    def after(t):
        return bool(generated_at and t and t > generated_at)

    out: list[dict[str, Any]] = []
    if event and event["source"] == "official":
        agency = attribution.get(event["source_feed"], event["source_feed"] or "Official agency")
        label = event["product"] or event["title"] or "Official warning"
        out.append({"at": iso(event["first_reported_at"]), "kind": "official", "type": "issued",
                    "label": f"{label} issued", "detail": agency, "after_brief": after(event["first_reported_at"])})
        upd = event["last_updated_at"]
        if upd and event["first_reported_at"] and (upd - event["first_reported_at"]).total_seconds() > 60:
            out.append({"at": iso(upd), "kind": "official", "type": "updated", "label": f"{label} updated",
                        "detail": agency, "after_brief": after(upd)})
        if event["expires_at"]:
            out.append({"at": iso(event["expires_at"]), "kind": "official", "type": "expires",
                        "label": "In force until", "detail": agency, "after_brief": False})
    for g in groups:
        sev = max(g["severities"], key=_SEVERITY.index) if g["severities"] else None
        out.append({"at": iso(g["first_seen"]), "until": iso(g["last_seen"]), "kind": "community",
                    "type": "reports", "label": g["effect"].replace("_", " ").capitalize(),
                    "reporters": g["reporters"], "severity": sev, "times": [iso(t) for t in g["times"]],
                    "after_brief": after(g["last_seen"])})
    return sorted(out, key=lambda e: e["at"] or "")
