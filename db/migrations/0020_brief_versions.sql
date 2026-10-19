-- Situational brief with "what changed" (docs/situation-brief-plan.md, Step 0).
--
-- briefs keeps the CURRENT brief per event (the route reads it). Every brief written is also
-- kept in brief_versions together with `facts`: the deterministic snapshot the next run diffs
-- against (severity, expiry, area in km², reporters per effect, title...). The diff is computed
-- in code; the model only puts it into words, so `changes` never holds a fact `facts` doesn't.
--
-- Brief text never decides anything: tier, severity and delivery ignore every column here.

-- claims:         [{text, basis: 'official' | 'community' | 'news', evidence: [citation ids]}]
-- contradictions: [string]  where reports or sources disagree
-- citations:      [{id, title, url?, kind: 'official' | 'community' | 'news'}]  ids like O1, C2, W1
-- changes:        "What changed" since the previous version (null on a first brief)
ALTER TABLE briefs ADD COLUMN version        integer NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE briefs ADD COLUMN claims         jsonb;
ALTER TABLE briefs ADD COLUMN contradictions jsonb;
ALTER TABLE briefs ADD COLUMN citations      jsonb;
ALTER TABLE briefs ADD COLUMN changes        text;
ALTER TABLE briefs ADD COLUMN changes_since  timestamptz;   -- generated_at of the version compared against

CREATE TABLE brief_versions (
    event_id    uuid NOT NULL REFERENCES events ON DELETE CASCADE,
    version     integer NOT NULL CHECK (version >= 1),
    created_at  timestamptz NOT NULL DEFAULT now(),
    facts       jsonb NOT NULL,     -- snapshot for the next diff
    brief       jsonb NOT NULL,     -- the brief as saved to briefs
    PRIMARY KEY (event_id, version)
);

-- Brief queue: the trigger sets brief_status = 'pending' and stamps brief_requested_at; it skips
-- events requested under 30 min ago (debounce). The worker leases pending events like the fusion
-- worker leases reports (0019): claimed_at/claimed_by, attempts, last error.
ALTER TABLE events ADD COLUMN brief_requested_at timestamptz;
ALTER TABLE events ADD COLUMN brief_claimed_at   timestamptz;
ALTER TABLE events ADD COLUMN brief_claimed_by   text;
ALTER TABLE events ADD COLUMN brief_attempts     integer NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN brief_error        text;

CREATE INDEX events_brief_pending_idx ON events (brief_requested_at) WHERE brief_status = 'pending';
