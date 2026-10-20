-- NWS zone boundaries, so alerts that name zones instead of drawing a polygon ("All of
-- northern and central Arizona") get their real area, not one point at the zones' mean
-- centre. Simplified (~500 m) like cap_geocodes. Zones cached before this have no area
-- yet: the poller refetches them the next time an alert names them (poller.resolve_zones).
ALTER TABLE nws_zones ADD COLUMN area geography(MultiPolygon, 4326);
