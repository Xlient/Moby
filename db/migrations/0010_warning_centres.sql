-- Global coverage, phase 2 (issues #8, #10): tsunami / tropical-cyclone warning centres,
-- EMSC earthquakes, and room for JMA (Japan) and BIPAD (Nepal).

ALTER TABLE events DROP CONSTRAINT events_source_feed_check;
ALTER TABLE events ADD CONSTRAINT events_source_feed_check
    CHECK (source_feed IN ('noaa', 'usgs', 'eonet', 'gdacs', 'cap', 'emsc', 'ptwc', 'jtwc', 'nhc', 'jma', 'bipad'));

ALTER TABLE feed_watermarks DROP CONSTRAINT feed_watermarks_feed_check;
ALTER TABLE feed_watermarks ADD CONSTRAINT feed_watermarks_feed_check
    CHECK (feed IN ('noaa', 'usgs', 'eonet', 'gdacs', 'emsc', 'ptwc', 'jtwc', 'nhc', 'jma', 'bipad')
           OR feed ~ '^cap:[a-z0-9-]+$');

INSERT INTO feed_watermarks (feed) VALUES ('emsc'), ('ptwc'), ('jtwc'), ('nhc'), ('jma'), ('bipad')
ON CONFLICT DO NOTHING;

-- The same earthquake arrives from several networks (USGS, EMSC, JMA...). The first
-- one stored stays the event; later copies point at it and are never listed or pushed.
-- Matching is deterministic (time, distance, magnitude) — never a model.
ALTER TABLE events ADD COLUMN magnitude real;
ALTER TABLE events ADD COLUMN ingested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE events ADD COLUMN duplicate_of uuid REFERENCES events (event_id) ON DELETE SET NULL;
CREATE INDEX events_quake_match_idx ON events (first_reported_at) WHERE hazard_type = 'earthquake' AND source = 'official';

-- Existing quakes: magnitude from the payload, so new arrivals can match them.
UPDATE events SET magnitude = (raw_payload->'properties'->>'mag')::real
WHERE source_feed = 'usgs' AND raw_payload->'properties'->>'mag' IS NOT NULL;
