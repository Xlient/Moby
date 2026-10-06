-- Global coverage, phase 1 (docs/spikes/global-coverage.md): official CAP feeds from
-- national warning services outside the US, and keeping USGS/GDACS/EONET events
-- worldwide instead of dropping everything outside the US boxes.

-- 'INTL' = outside the US/CN deployment regions. Delivery and GET /alerts are
-- distance-based, so these work for anyone standing near them (travellers included).
ALTER TABLE events DROP CONSTRAINT events_region_check;
ALTER TABLE events ADD CONSTRAINT events_region_check CHECK (region IN ('US', 'CN', 'INTL'));

-- The alert's actual area when the source gives one (CAP polygons/circles). Proximity
-- uses it instead of the centre point: inside a big warning area means distance 0,
-- even when its centroid is far away. NULL = point events (quakes) and older rows.
ALTER TABLE events ADD COLUMN area geography(MultiPolygon, 4326);
CREATE INDEX events_area_gix ON events USING gist (area) WHERE area IS NOT NULL;

-- ISO 3166-1 alpha-2 of the issuing authority (CAP) or the event (when the feed says).
ALTER TABLE events ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$');

ALTER TABLE events DROP CONSTRAINT events_source_feed_check;
ALTER TABLE events ADD CONSTRAINT events_source_feed_check
    CHECK (source_feed IN ('noaa', 'usgs', 'eonet', 'gdacs', 'cap'));

-- One watermark per CAP source: 'cap:ph-pagasa-en', 'cap:mx-smn-es', ...
ALTER TABLE feed_watermarks DROP CONSTRAINT feed_watermarks_feed_check;
ALTER TABLE feed_watermarks ADD CONSTRAINT feed_watermarks_feed_check
    CHECK (feed IN ('noaa', 'usgs', 'eonet', 'gdacs') OR feed ~ '^cap:[a-z0-9-]+$');

-- CAP feeds list links to individual alert documents. Each document is immutable
-- (an update is a new document), so we fetch each URL once.
CREATE TABLE cap_documents (
    url        text PRIMARY KEY,
    source_id  text NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    -- Network failures aren't recorded, so the document is retried on the next poll.
    outcome    text NOT NULL CHECK (outcome IN ('stored', 'cancel', 'skipped')),
    detail     text
);
CREATE INDEX cap_documents_source_idx ON cap_documents (source_id, fetched_at);
