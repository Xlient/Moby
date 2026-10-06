-- Translated alerts (issue #11). Official text stays in title/description exactly as
-- the agency wrote it; the English translation sits beside it and is always labelled
-- as Moby's. 'failed' (e.g. a number didn't survive) means: show the original only.
ALTER TABLE events ADD COLUMN language text;                 -- BCP 47 of title/description; NULL = English
ALTER TABLE events ADD COLUMN title_en text CHECK (char_length(title_en) <= 300);
ALTER TABLE events ADD COLUMN description_en text CHECK (char_length(description_en) <= 4000);
ALTER TABLE events ADD COLUMN translation_status text NOT NULL DEFAULT 'not_needed'
    CHECK (translation_status IN ('not_needed', 'pending', 'done', 'failed'));
ALTER TABLE events ADD COLUMN translation_model text;
CREATE INDEX events_translation_pending_idx ON events (last_updated_at) WHERE translation_status = 'pending';
