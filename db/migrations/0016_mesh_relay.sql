-- Bluetooth mesh relay (contract 0.7.0): reports that hopped phone to phone.
--
-- A report is identified on the air by an 8-byte `mesh_key` = first 8 bytes of
-- sha256(client_event_id), hex. The same key is stored for ordinary reports, so when
-- the original reporter later reconnects and sends the full report (with its note),
-- the API upgrades the mesh copy instead of creating a second report from one person.
--
-- 0015 is taken by the ai-features branch; this is 0016 so the two never collide.
ALTER TABLE reports ADD COLUMN mesh_key text;
CREATE UNIQUE INDEX reports_mesh_key_uidx ON reports (mesh_key) WHERE mesh_key IS NOT NULL;

UPDATE reports
SET mesh_key = encode(substring(sha256(convert_to(client_event_id, 'UTF8')) FROM 1 FOR 8), 'hex')
WHERE source = 'manual';
