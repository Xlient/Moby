-- Privacy (docs/spikes/privacy-gdpr.md): retention and erasure.

-- Reports are anonymised after the retention period: note, reporter, structured text and
-- embedding removed, location coarsened. The aggregate (the event) stays.
ALTER TABLE reports ADD COLUMN anonymised_at timestamptz;
CREATE INDEX reports_retention_idx ON reports (received_at) WHERE anonymised_at IS NULL;

-- Accountability for erasure requests without keeping who asked: counts only.
CREATE TABLE erasure_log (
    erasure_id  bigserial PRIMARY KEY,
    erased_at   timestamptz NOT NULL DEFAULT now(),
    reports     integer NOT NULL,
    devices     integer NOT NULL,
    areas       integer NOT NULL
);
