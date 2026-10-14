-- Delivery (handoff contracts 3–5): push devices, watched areas, per-user alert
-- preferences, a log of every push, and situational briefs.
--
-- People are identified only by `owner` = reporter_hash (HMAC(salt, Firebase uid)),
-- the same pseudonym reports use: the database never holds a Firebase uid or email.

-- Contract 3: draft_alert writes these; delivery falls back to the official title/description.
ALTER TABLE events ADD COLUMN alert_headline text CHECK (char_length(alert_headline) <= 120);
ALTER TABLE events ADD COLUMN alert_body     text CHECK (char_length(alert_body) <= 600);

CREATE TABLE devices (
    device_id      text PRIMARY KEY,                    -- client-generated UUID, stable per install
    owner          text NOT NULL,
    push_provider  text NOT NULL CHECK (push_provider IN ('fcm', 'apns')),
    push_token     text NOT NULL,
    platform       text NOT NULL CHECK (platform IN ('ios', 'android')),
    registered_at  timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    -- Set when the provider says the token is dead (app uninstalled); cleared on re-register.
    disabled_at    timestamptz
);
CREATE INDEX devices_owner_idx ON devices (owner) WHERE disabled_at IS NULL;
-- A token belongs to one install; a re-registration under a new device_id replaces the old row.
CREATE UNIQUE INDEX devices_token_unique ON devices (push_token);

CREATE TABLE subscriptions (
    subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner           text NOT NULL,
    -- 'area': a place the person saved. 'near_me': follows the phone (coarse, ~1 km),
    -- at most one per person, maintained by the app.
    kind            text NOT NULL DEFAULT 'area' CHECK (kind IN ('area', 'near_me')),
    region          text NOT NULL DEFAULT 'US' CHECK (region IN ('US', 'CN')),
    label           text CHECK (char_length(label) <= 64),
    center          geography(Point, 4326) NOT NULL,
    radius_km       real NOT NULL CHECK (radius_km > 0 AND radius_km <= 500),
    min_severity    text NOT NULL DEFAULT 'medium' CHECK (min_severity IN ('low', 'medium', 'high', 'critical')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_center_gix ON subscriptions USING gist (center);
CREATE INDEX subscriptions_owner_idx  ON subscriptions (owner);
CREATE UNIQUE INDEX subscriptions_one_near_me ON subscriptions (owner) WHERE kind = 'near_me';

-- Contract `AlertPreferences`; absent row = defaults. Applies to GET /alerts and push alike.
CREATE TABLE user_preferences (
    owner             text PRIMARY KEY,
    alert_preferences jsonb NOT NULL,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per push attempt. The unique key makes fan-out idempotent: a device is told
-- about an event once per severity, so a re-run never double-notifies and an upgrade
-- (high → critical) notifies again.
CREATE TABLE deliveries (
    delivery_id bigserial PRIMARY KEY,
    event_id    uuid NOT NULL REFERENCES events ON DELETE CASCADE,
    device_id   text NOT NULL REFERENCES devices ON DELETE CASCADE,
    severity    text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status      text NOT NULL CHECK (status IN ('sent', 'failed', 'invalid_token')),
    attempts    smallint NOT NULL DEFAULT 1,             -- 'failed' is retried up to 3 attempts
    error       text,
    sent_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT deliveries_once UNIQUE (event_id, device_id, severity)
);
CREATE INDEX deliveries_sent_at_idx ON deliveries (sent_at);

-- Contract 4: the situational_brief job writes one row per event and sets events.brief_status.
CREATE TABLE briefs (
    event_id           uuid PRIMARY KEY REFERENCES events ON DELETE CASCADE,
    generated_at       timestamptz NOT NULL DEFAULT now(),
    model              text NOT NULL,
    summary            text NOT NULL,
    likely_progression text,
    exposed_areas      jsonb,                           -- [{description, location?, rationale?}]
    official_guidance  text,
    uncertainty        text NOT NULL CHECK (uncertainty <> ''),   -- required: never render a brief as certainty
    sources            jsonb                            -- [string]
);
