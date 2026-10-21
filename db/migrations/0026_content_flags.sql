-- "This looks wrong": people report AI output and community reports from inside the app
-- (Google Play's AI-Generated Content and User-Generated Content policies).
--
-- A flag never hides anything by itself (no review gate): local partners see open flags
-- in the console. A flag on a community report also puts its event in the review queue
-- (reason 'user_flag'), where a reviewer can take it down with the existing Reject.
--
-- What is flagged:
--   ask_answer        Ask Moby answer (not stored anywhere): excerpt holds the answer text
--   explanation       "What this means for you" on an alert: target_id = event_id
--   brief             situation brief on an alert: target_id = event_id
--   trip_brief        "Before you go" briefing (cached for 2 days only): excerpt holds it
--   community_report  one community report: target_id = report_id, event_id = its event
CREATE TABLE content_flags (
    flag_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Who flagged (pseudonymous, like reports.reporter_hash): rate limit, export, erasure.
    reporter_hash   text NOT NULL,
    kind            text NOT NULL
        CHECK (kind IN ('ask_answer', 'explanation', 'brief', 'trip_brief', 'community_report')),
    target_id       text CHECK (char_length(target_id) <= 64),
    event_id        uuid REFERENCES events (event_id) ON DELETE SET NULL,
    excerpt         text CHECK (char_length(excerpt) <= 2000),
    reason          text NOT NULL CHECK (reason IN ('wrong', 'harmful', 'spam', 'other')),
    note            text CHECK (char_length(note) <= 500),
    created_at      timestamptz NOT NULL DEFAULT now(),

    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolved_by     text,                       -- hashed reviewer id (never the raw uid)
    resolved_at     timestamptz,

    CONSTRAINT content_flags_has_target CHECK (target_id IS NOT NULL OR excerpt IS NOT NULL)
);

CREATE INDEX content_flags_open_idx ON content_flags (created_at) WHERE status = 'open';
CREATE INDEX content_flags_reporter_idx ON content_flags (reporter_hash, created_at);

ALTER TABLE review_queue DROP CONSTRAINT review_queue_reason_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_reason_check
    CHECK (reason IN ('tier1_corroborated', 'severity_floor', 'conflicting_reports', 'low_confidence', 'user_flag'));
