-- Sprint 1: lock the embedding dimension and add what the feed poller needs.

-- ---------------------------------------------------------------------------
-- Embeddings. Model and dimension are locked here (see docs/models.md):
--   Qwen/Qwen3-Embedding-8B via Token Factory, requested at 1024 dims
--   (Matryoshka truncation of the native 4096; unit-normalised by the API).
-- 1024 keeps us under pgvector's 2000-dim limit for HNSW indexes. Changing the
-- model or dimension means a new migration and a full re-embed.
-- ---------------------------------------------------------------------------
ALTER TABLE reports ADD COLUMN embedding vector(1024);
ALTER TABLE events  ADD COLUMN embedding vector(1024);

-- Stage 2 of fuse_dedup: cosine similarity (<=>) among spatially-near candidates.
CREATE INDEX reports_embedding_hnsw ON reports USING hnsw (embedding vector_cosine_ops);
CREATE INDEX events_embedding_hnsw  ON events  USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Feeds without ETag / Last-Modified (EONET, GDACS) are deduplicated by a hash of
-- the response body, so an unchanged payload is skipped across restarts too.
-- ---------------------------------------------------------------------------
ALTER TABLE feed_watermarks ADD COLUMN content_hash text;

-- ---------------------------------------------------------------------------
-- NWS forecast/county/fire zones. Most api.weather.gov alerts carry no geometry,
-- only affectedZones URLs; we resolve each zone once and cache its centroid.
-- Zones change rarely (a few times a year), so a stale cache is harmless.
-- ---------------------------------------------------------------------------
CREATE TABLE nws_zones (
    zone_id     text PRIMARY KEY,                  -- e.g. CAZ112
    zone_url    text NOT NULL,
    name        text,
    centroid    geography(Point, 4326),            -- NULL when the zone has no geometry
    fetched_at  timestamptz NOT NULL DEFAULT now()
);
