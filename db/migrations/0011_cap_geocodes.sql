-- Boundaries for CAP messages that name areas by code instead of a polygon (issue #9),
-- e.g. MeteoAlarm EMMA_IDs. Loaded by `python -m moby.feeds.geocodes`; the CAP poller
-- turns a message's geocodes into its area by union of these shapes.
CREATE TABLE cap_geocodes (
    scheme    text NOT NULL,                       -- CAP valueName, e.g. 'EMMA_ID'
    code      text NOT NULL,                       -- e.g. 'GR013'
    country   text CHECK (country ~ '^[A-Z]{2}$'),
    name      text,
    area      geography(MultiPolygon, 4326) NOT NULL,   -- simplified (~500 m) for speed
    source    text NOT NULL,                       -- where the boundary came from (attribution)
    loaded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scheme, code)
);
