-- Extensions live in a migration (not a Docker init script) so the identical
-- schema can be applied to a managed Postgres (Neon / Supabase) as well.
CREATE EXTENSION IF NOT EXISTS postgis;   -- geography type, ST_DWithin, GiST spatial indexes
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector: embeddings + cosine distance (<=>)
