-- Earthquakes expire a day after they happen (moby/feeds/usgs.py QUAKE_TTL), as JMA's
-- already did. USGS and EMSC quakes used to be stored with no expiry, and nothing else
-- ended them, so every quake since the database started was listed as an active alert.
-- New polls set expires_at; this ends the ones already stored.
UPDATE events SET expires_at = first_reported_at + interval '24 hours'
WHERE source_feed IN ('usgs', 'emsc') AND expires_at IS NULL;
