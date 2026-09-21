-- Derived from api-contract-v1.yaml (Event, ReportSubmission) and plan v3 §12 Week 1.
-- Enum-like columns use CHECK constraints rather than CREATE TYPE so adding a
-- value later is a one-line ALTER, not an enum migration.

-- ---------------------------------------------------------------------------
-- events: fused events. Official feed items (NOAA/USGS/...) and manual/mesh
-- clusters share one table so the fusion agent can search them together and
-- "official_match" is just a self-reference.
-- ---------------------------------------------------------------------------
CREATE TABLE events (
    event_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source                  text NOT NULL CHECK (source IN ('official', 'manual', 'mesh')),
    source_feed             text CHECK (source_feed IN ('noaa', 'usgs', 'eonet', 'gdacs')),
    external_id             text,                       -- id within the source feed
    region                  text NOT NULL DEFAULT 'US' CHECK (region IN ('US', 'CN')),

    hazard_type             text NOT NULL
        CHECK (hazard_type IN ('flood', 'fire', 'earthquake', 'storm', 'landslide', 'other')),
    observed_effect         text
        CHECK (observed_effect IN ('rising_water', 'structural_damage', 'smoke_or_fire_visible',
                                   'ground_shaking', 'blocked_road', 'other')),
    severity                text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    title                   text,                       -- official headline, if any
    description             text,
    location                geography(Point, 4326) NOT NULL,   -- WGS84; ST_MakePoint(lon, lat)
    location_accuracy_m     real,

    first_reported_at       timestamptz NOT NULL DEFAULT now(),
    last_updated_at         timestamptz NOT NULL DEFAULT now(),
    expires_at              timestamptz,                -- official alerts carry an expiry

    tier                    smallint NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 2),
    confidence              real NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
    specificity_score       real CHECK (specificity_score BETWEEN 0 AND 1),
    distinct_reporter_count integer NOT NULL DEFAULT 0 CHECK (distinct_reporter_count >= 0),
    confirm_count           integer NOT NULL DEFAULT 0 CHECK (confirm_count >= 0),
    deny_count              integer NOT NULL DEFAULT 0 CHECK (deny_count >= 0),

    official_match_id       uuid REFERENCES events (event_id) ON DELETE SET NULL,
    reviewer_decision       text CHECK (reviewer_decision IN ('approve', 'reject', 'hold')),
    brief_status            text NOT NULL DEFAULT 'not_requested'
        CHECK (brief_status IN ('not_requested', 'pending', 'ready', 'failed')),

    raw_payload             jsonb,                      -- untouched feed item; backtest corpus

    -- official rows must identify their feed item; non-official rows must not.
    CONSTRAINT events_official_has_feed_id CHECK (
        (source = 'official') = (source_feed IS NOT NULL AND external_id IS NOT NULL)
    ),
    -- idempotent upserts: INSERT ... ON CONFLICT (source_feed, external_id) DO UPDATE
    -- (NULLs are distinct in unique constraints, so manual/mesh rows are unaffected)
    CONSTRAINT events_feed_item_unique UNIQUE (source_feed, external_id)
);

-- Stage 1 of fuse_dedup: "events within R metres and T time of this report".
CREATE INDEX events_location_gix     ON events USING gist (location);
CREATE INDEX events_reported_at_idx  ON events (first_reported_at);
CREATE INDEX events_tier_updated_idx ON events (tier, last_updated_at DESC);
CREATE INDEX events_hazard_time_idx  ON events (hazard_type, first_reported_at);

-- NOTE: Event.verification_label from the contract is derived (source + tier +
-- official_match_id), not stored, so it can never drift out of sync with tier.

-- ---------------------------------------------------------------------------
-- reports: raw human reports. Written FIRST (POST /reports -> 202), fused later,
-- so event_id is NULL until fusion attaches it.
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
    report_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_event_id    text NOT NULL UNIQUE,            -- client UUID: idempotency key, retries are safe
    event_id           uuid REFERENCES events (event_id) ON DELETE SET NULL,
    fusion_status      text NOT NULL DEFAULT 'pending'
        CHECK (fusion_status IN ('pending', 'fused', 'failed')),

    source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'mesh')),
    reporter_hash      text NOT NULL,                   -- anonymised originator; corroboration counts DISTINCT values
    relayed_by         text[] NOT NULL DEFAULT '{}',    -- mesh hops; never counted as corroboration

    hazard_type        text NOT NULL
        CHECK (hazard_type IN ('flood', 'fire', 'earthquake', 'storm', 'landslide', 'other')),
    observed_effect    text
        CHECK (observed_effect IN ('rising_water', 'structural_damage', 'smoke_or_fire_visible',
                                   'ground_shaking', 'blocked_road', 'other')),
    severity           text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    location           geography(Point, 4326) NOT NULL,
    location_accuracy_m real,
    observed_at        timestamptz NOT NULL,
    received_at        timestamptz NOT NULL DEFAULT now(),
    captured_offline   boolean NOT NULL DEFAULT false,

    note               text,                            -- raw free text (<= 1000 chars per contract)
    structured         jsonb                            -- output of structure_report, once run
);

CREATE INDEX reports_location_gix      ON reports USING gist (location);
CREATE INDEX reports_event_idx         ON reports (event_id);
CREATE INDEX reports_reporter_time_idx ON reports (reporter_hash, observed_at);   -- per-device caps (Sybil dampening)
CREATE INDEX reports_pending_idx       ON reports (received_at) WHERE fusion_status = 'pending';

-- Embedding column is deliberately NOT here yet: pgvector needs a fixed dimension
-- and the embedding model is still to be chosen and verified (plan v3, Week 1).
-- Once it is, add 0003 with: ALTER TABLE reports ADD COLUMN embedding vector(<dim>);

-- ---------------------------------------------------------------------------
-- feed_watermarks: per-feed polling state for ETag / If-Modified-Since
-- conditional requests and downtime tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE feed_watermarks (
    feed                 text PRIMARY KEY CHECK (feed IN ('noaa', 'usgs', 'eonet', 'gdacs')),
    etag                 text,
    last_modified        text,                          -- stored verbatim as the HTTP header value
    last_polled_at       timestamptz,
    last_success_at      timestamptz,
    last_status          integer,                       -- last HTTP status (200 / 304 / 5xx ...)
    consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    last_error           text,
    updated_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO feed_watermarks (feed) VALUES ('noaa'), ('usgs'), ('eonet'), ('gdacs');
