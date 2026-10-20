-- Official alerts in the phone's language: Moby's translations of the agency's own text,
-- per language, made the first time someone with that language opens the alert (or is
-- pushed it) and cached here: {"ja": {"headline": "...", "body": "..."}, "ko": null, ...}.
-- null = tried and failed its checks, so it isn't retried (and paid for) by every reader.
-- title_en/description_en stay the checked English that explanations are grounded in.
ALTER TABLE events ADD COLUMN translations jsonb NOT NULL DEFAULT '{}'::jsonb;
