-- Visible AI features (docs/hackathon-strategy.md):
--   "What this means for you": a plain-language explanation of an official warning,
--   written by Nemotron Super from the agency's own text, cached per event.
--   "Ask Moby": retrieval over guidance cards needs their embeddings.

ALTER TABLE events ADD COLUMN explainer jsonb;            -- {summary, actions[], model, generated_at}
ALTER TABLE events ADD COLUMN explainer_status text NOT NULL DEFAULT 'none'
    CHECK (explainer_status IN ('none', 'pending', 'done', 'failed'));
CREATE INDEX events_explainer_pending_idx ON events (last_updated_at) WHERE explainer_status = 'pending';

ALTER TABLE guidance_cards ADD COLUMN embedding vector(1024);
CREATE INDEX guidance_cards_embedding_hnsw ON guidance_cards USING hnsw (embedding vector_cosine_ops);
