-- "Before you go" trip briefings (moby/ai/trip.py, contract 0.9.0).
--
-- Only the part that costs money is cached: Nemotron Ultra's explanation and the Tavily
-- results. The alert and report lists are re-queried on every request (PostGIS, cheap), so
-- a briefing never misses a warning issued after the cache entry was written.
--
-- Privacy: no user id, device or IP here. The destination is snapped to a ~1 km grid
-- before it is used at all, and rows older than two days are deleted on every write.
-- `inputs` is a hash of the alerts and reports the text explains (ids + last update), so
-- the same destination with a new or updated alert gets a new explanation.
CREATE TABLE trip_brief_cache (
    cache_key   text PRIMARY KEY,        -- sha256(day, lat, lon, radius, country, inputs)
    day         date NOT NULL,           -- UTC
    lat         real NOT NULL,           -- snapped to 0.01°
    lon         real NOT NULL,
    radius_km   real NOT NULL,
    payload     jsonb NOT NULL,          -- {explanation, ai_status, web_sources, web_status}
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_brief_cache_day_idx ON trip_brief_cache (day);
