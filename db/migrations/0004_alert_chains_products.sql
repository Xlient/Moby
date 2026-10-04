-- Alert chains, product names and marine flag for official events.

-- ---------------------------------------------------------------------------
-- feed_item_ids: every feed identifier that belongs to this event, oldest first.
-- NWS replaces an alert with Update messages that carry NEW identifiers and
-- reference the old ones. Keeping the whole chain on one row gives the event a
-- stable event_id across updates, so tier, brief, reviewer decision and anything
-- the graph attached survive. external_id stays the chain's first identifier.
-- ---------------------------------------------------------------------------
ALTER TABLE events ADD COLUMN feed_item_ids text[] NOT NULL DEFAULT '{}';
UPDATE events SET feed_item_ids = ARRAY[external_id] WHERE external_id IS NOT NULL;
CREATE INDEX events_feed_item_ids_gin ON events USING gin (feed_item_ids);

-- ---------------------------------------------------------------------------
-- product: the source's own name for what this is ("Flood Warning", "Small Craft
-- Advisory", "earthquake", GDACS "TC", EONET "wildfires"). Lets users and the UI
-- filter more finely than hazard_type.
-- marine: offshore/marine products. Ingested, but hidden unless a user opts in.
-- ---------------------------------------------------------------------------
ALTER TABLE events ADD COLUMN product text;
ALTER TABLE events ADD COLUMN marine boolean NOT NULL DEFAULT false;
UPDATE events SET product = raw_payload->'properties'->>'event' WHERE source_feed = 'noaa';

-- "Active alerts near a point" (alerts_near): filter on not-expired official rows.
CREATE INDEX events_active_idx ON events (expires_at) WHERE source = 'official';
