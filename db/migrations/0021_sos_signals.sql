-- SOS over the Bluetooth mesh: "someone near here asked for help".
--
-- A person with no signal sends an SOS from Moby's "I need help" screen; nearby Moby
-- phones show it and pass it on, and any phone with signal uploads it here (POST
-- /v1/mesh/sync, hazard code 6). Reviewers (local partners: rangers, officials) see
-- them in the console and decide whether to act. Moby never forwards them to
-- emergency services by itself, and never tells the sender that anyone saw it.
--
-- Kept apart from `reports` on purpose: an SOS is a person, not a hazard, so it must
-- never be fused into a hazard event or pushed as an alert.
--
-- 0020 is taken by the situation-brief branch (sprint-7-nano); this is 0021 so the two never collide.
CREATE TABLE sos_signals (
    sos_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- The 8-byte id on the air (hex); a retry or another relay path merges into one row.
    mesh_key        text NOT NULL UNIQUE,
    -- The sender's daily-rotating mesh id ("mesh:<hex>"): links an SOS to its "I'm safe".
    reporter_hash   text NOT NULL,
    status          text NOT NULL CHECK (status IN ('help', 'safe')),
    location        geography(Point, 4326) NOT NULL,
    location_accuracy_m real,
    sent_at         timestamptz NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),
    hop_count       smallint NOT NULL,
    relayed_by      text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX sos_signals_sent_idx ON sos_signals (sent_at DESC);
CREATE INDEX sos_signals_reporter_idx ON sos_signals (reporter_hash, sent_at);
