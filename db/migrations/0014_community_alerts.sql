-- Community reports without a review gate (contract 0.6.0).
--
-- Community events are delivered as unverified, labelled, to people who opted in
-- (AlertPreferences.community_reports); review is optional. When people nearby report
-- different severities the fusion pipeline keeps the highest and sets this flag, so the
-- app and the push can say the reports disagree instead of hiding it.
ALTER TABLE events ADD COLUMN reports_disagree boolean NOT NULL DEFAULT false;
