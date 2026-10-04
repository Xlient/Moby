-- One-time backfill of tier/confidence for official rows ingested before the
-- official tier policy existed. New rows get these from moby/escalation/official.py;
-- this mirrors that policy and must not be edited after it has run.
-- Rows a reviewer has already decided on are left alone.
UPDATE events SET tier = GREATEST(tier, 2), confidence = GREATEST(confidence, 0.95)
WHERE source_feed = 'noaa' AND reviewer_decision IS NULL;

UPDATE events SET tier = GREATEST(tier, 2),
                  confidence = GREATEST(confidence,
                      CASE WHEN raw_payload->'properties'->>'status' = 'reviewed' THEN 0.95 ELSE 0.85 END)
WHERE source_feed = 'usgs' AND reviewer_decision IS NULL;

UPDATE events SET tier = GREATEST(tier, 2), confidence = GREATEST(confidence, 0.8)
WHERE source_feed = 'gdacs' AND reviewer_decision IS NULL;

UPDATE events SET tier = GREATEST(tier, 1), confidence = GREATEST(confidence, 0.7)
WHERE source_feed = 'eonet' AND reviewer_decision IS NULL;

UPDATE events SET product = 'earthquake' WHERE source_feed = 'usgs' AND product IS NULL;
