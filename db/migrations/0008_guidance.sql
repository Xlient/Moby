-- Offline guidance cards (plan v3 §8.1; contract GuidanceBundle / GuidanceCard).
--
-- The guidance job (moby/jobs/guidance.py) writes a *draft* bundle: cards synthesized
-- by Ultra from official pages, each with verbatim evidence quotes from its source.
-- A person reviews and publishes it (scripts/guidance.py); only published bundles are
-- served, and publishing a new version retires the previous one for that region.

CREATE TABLE guidance_bundles (
    bundle_id     text PRIMARY KEY,                       -- e.g. 'us-2026-10-04-1'
    region        text NOT NULL CHECK (region IN ('US', 'CN')),
    version       text NOT NULL,
    status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
    content_hash  text NOT NULL,                          -- sha256 of the cards JSON the app downloads
    size_bytes    integer NOT NULL,
    generated_at  timestamptz NOT NULL DEFAULT now(),
    model         text,                                   -- which model synthesized the cards
    published_at  timestamptz,
    published_by  text,
    UNIQUE (region, version)
);
-- At most one live bundle per region.
CREATE UNIQUE INDEX guidance_one_published ON guidance_bundles (region) WHERE status = 'published';

CREATE TABLE guidance_cards (
    card_id              text NOT NULL,
    bundle_id            text NOT NULL REFERENCES guidance_bundles ON DELETE CASCADE,
    hazard_type          text NOT NULL
        CHECK (hazard_type IN ('flood', 'fire', 'earthquake', 'storm', 'landslide', 'other')),
    applies_when         text CHECK (char_length(applies_when) <= 120),
    title                text NOT NULL CHECK (char_length(title) <= 120),
    body                 text NOT NULL CHECK (char_length(body) <= 1200),
    priority             smallint NOT NULL DEFAULT 50,    -- lower = more urgent
    source_name          text NOT NULL,
    source_url           text NOT NULL,
    last_reviewed_at     timestamptz NOT NULL,            -- when the source page was fetched and the card checked
    is_critical_fallback boolean NOT NULL DEFAULT false,
    -- Verbatim quotes from the source page that back the card (checked by the job).
    -- Kept for reviewers and audits; not sent to the app.
    evidence             jsonb NOT NULL DEFAULT '[]',
    PRIMARY KEY (bundle_id, card_id)
);
CREATE INDEX guidance_cards_hazard_idx ON guidance_cards (bundle_id, hazard_type);
