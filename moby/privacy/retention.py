"""Retention (docs/spikes/privacy-gdpr.md): keep personal data only as long as it's useful.

  reports     anonymised after REPORT_DAYS: note, reporter, structured extraction and
              embedding removed; location rounded to ~1 km. The event they formed stays.
  deliveries  deleted after DELIVERY_DAYS (only needed to avoid double pushes).
  devices     deleted after DEVICE_DAYS without re-registration (app uninstalled).

Run by the delivery worker every few hours; safe to run any time, any number of times.
"""
import logging

from psycopg import AsyncConnection

log = logging.getLogger("moby.privacy.retention")

REPORT_DAYS = 90
DELIVERY_DAYS = 30
DEVICE_DAYS = 180

# A unique placeholder per report keeps distinct-reporter counts of old events intact
# without being linkable to a person (or to other reports from the same person).
ANONYMISE_REPORTS_SQL = """
UPDATE reports SET
    note = NULL,
    structured = NULL,
    embedding = NULL,
    reporter_hash = 'anon:' || report_id::text,
    location = ST_SetSRID(ST_MakePoint(round(ST_X(location::geometry)::numeric, 2),
                                       round(ST_Y(location::geometry)::numeric, 2)), 4326)::geography,
    location_accuracy_m = GREATEST(coalesce(location_accuracy_m, 0), 1000),
    anonymised_at = now()
WHERE anonymised_at IS NULL AND received_at < now() - make_interval(days => %(days)s)
"""


async def apply_retention(conn: AsyncConnection) -> dict[str, int]:
    async with conn.transaction():
        reports = (await conn.execute(ANONYMISE_REPORTS_SQL, {"days": REPORT_DAYS})).rowcount
        deliveries = (await conn.execute(
            "DELETE FROM deliveries WHERE sent_at < now() - make_interval(days => %s)", (DELIVERY_DAYS,))).rowcount
        devices = (await conn.execute(
            "DELETE FROM devices WHERE updated_at < now() - make_interval(days => %s)", (DEVICE_DAYS,))).rowcount
    counts = {"reports_anonymised": reports, "deliveries_deleted": deliveries, "devices_deleted": devices}
    if any(counts.values()):
        log.info("retention: %s", counts)
    return counts
