-- Human-in-the-loop review queue (plan v3 §10, Week 3).
--
-- Contract between the fusion pipeline (LangGraph) and the reviewer console:
--   * The pipeline INSERTs a row when its `interrupt` pauses an event for review.
--   * The console reads open rows (GET /review/queue) and records a decision
--     (POST /review/{event_id}/decision), which sets status='decided' here and
--     events.reviewer_decision.
--   * The pipeline picks up decided rows and resumes graph_thread_id.
-- Neither side calls the other directly.
CREATE TABLE review_queue (
    event_id              uuid PRIMARY KEY REFERENCES events (event_id) ON DELETE CASCADE,
    reason                text NOT NULL
        CHECK (reason IN ('tier1_corroborated', 'severity_floor', 'conflicting_reports', 'low_confidence')),
    queued_at             timestamptz NOT NULL DEFAULT now(),
    adjudicator_rationale text,                       -- shown to the reviewer as-is
    graph_thread_id       text,                       -- LangGraph thread to resume after the decision

    status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided')),
    decision              text CHECK (decision IN ('approve', 'reject', 'hold')),
    decision_note         text CHECK (char_length(decision_note) <= 500),
    override_severity     text CHECK (override_severity IN ('low', 'medium', 'high', 'critical')),
    decided_by            text,                       -- hashed reviewer id (never the raw uid)
    decided_at            timestamptz,

    CONSTRAINT review_decided_has_decision CHECK ((status = 'decided') = (decision IS NOT NULL))
);

-- Console: open items, severity-floor first, oldest first within a reason.
CREATE INDEX review_queue_open_idx ON review_queue (queued_at) WHERE status = 'open';
-- Pipeline: decided items waiting to be resumed.
CREATE INDEX review_queue_decided_idx ON review_queue (decided_at) WHERE status = 'decided';
