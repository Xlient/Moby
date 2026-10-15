-- Fusion worker (moby/graph/worker.py): leases on pending reports.
--
-- A worker CLAIMS a batch of pending reports by stamping claimed_at/claimed_by and commits
-- straight away (no long-held row locks, so the graph's own connections can update the
-- rows). If the worker dies, its claim simply expires after the lease and another worker
-- takes the report. attempts counts tries; after MAX_ATTEMPTS a report is marked 'failed'
-- (a "poison message" must not be retried forever). fusion_error keeps the last error.
ALTER TABLE reports ADD COLUMN claimed_at   timestamptz;
ALTER TABLE reports ADD COLUMN claimed_by   text;
ALTER TABLE reports ADD COLUMN attempts     integer NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN fusion_error text;
