-- Earthquakes expire a day after they happen, three days for strong ones (moby/feeds/usgs.py
-- quake_ttl), as JMA's already did. USGS and EMSC quakes used to be stored with no expiry,
-- and nothing else ended them, so every quake since the database started was listed as an
-- active alert. New polls set expires_at; this ends the ones already stored.
UPDATE events SET expires_at = first_reported_at
    + CASE WHEN severity IN ('high', 'critical') THEN interval '72 hours' ELSE interval '24 hours' END
WHERE source_feed IN ('usgs', 'emsc') AND expires_at IS NULL;
