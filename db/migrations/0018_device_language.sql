-- The phone's language (ISO 639-1, e.g. 'es'), so pushes can carry Moby's plain-language
-- explanation in it (moby/ai/localize.py). NULL = English.
ALTER TABLE devices ADD COLUMN language text CHECK (language ~ '^[a-z]{2,3}$');
