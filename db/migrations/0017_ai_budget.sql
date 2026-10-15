-- Daily caps on paid calls (moby/ai/budget.py): one row per UTC day and feature.
-- Bounds what Token Factory and Tavily can cost, whatever the traffic.
CREATE TABLE ai_usage (
    day      date NOT NULL,
    feature  text NOT NULL,
    used     integer NOT NULL DEFAULT 0 CHECK (used >= 0),
    PRIMARY KEY (day, feature)
);
