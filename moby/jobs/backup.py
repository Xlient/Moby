"""Serverless Job: back up the database to object storage.

Streams `pg_dump --format=custom` from the API and writes it under BACKUP_DIR —
on Nebius that directory is an S3 bucket mounted into the job
(`--volume s3://BUCKET:/backup`), so the dump lands in the bucket with no SDK.
Keeps the newest BACKUP_KEEP dumps (default 14).

Restore:  pg_restore --clean --if-exists -d "$DATABASE_URL" moby-YYYYmmdd-HHMMSS.dump

    MOBY_API_URL=... MOBY_SERVICE_TOKEN=... BACKUP_DIR=/backup python -m moby.jobs.backup
"""
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

log = logging.getLogger("moby.jobs.backup")
PGDMP_MAGIC = b"PGDMP"  # every custom-format dump starts with this


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    api = os.environ["MOBY_API_URL"].rstrip("/")
    out_dir = Path(os.environ.get("BACKUP_DIR", "/backup"))
    keep = int(os.environ.get("BACKUP_KEEP", "14"))
    out_dir.mkdir(parents=True, exist_ok=True)

    name = f"moby-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.dump"
    tmp, final = out_dir / f".{name}.part", out_dir / name
    size = 0
    try:
        with httpx.stream("GET", f"{api}/internal/v1/backup",
                          headers={"Authorization": f"Bearer {os.environ['MOBY_SERVICE_TOKEN']}"},
                          timeout=httpx.Timeout(60, read=600)) as resp:
            if resp.status_code != 200:
                log.error("backup request failed: HTTP %d %s", resp.status_code, resp.read()[:200].decode(errors="replace"))
                return 1
            with tmp.open("wb") as f:
                for chunk in resp.iter_bytes(1 << 16):
                    f.write(chunk)
                    size += len(chunk)

        # A truncated or error stream must never replace a good backup.
        with tmp.open("rb") as f:
            if size < 1024 or f.read(5) != PGDMP_MAGIC:
                log.error("backup invalid (%d bytes); kept previous backups", size)
                return 1
        tmp.rename(final)
    finally:
        tmp.unlink(missing_ok=True)  # no-op after a successful rename
    log.info("wrote %s (%.1f MB)", final, size / 1e6)

    dumps = sorted(out_dir.glob("moby-*.dump"))
    for old in dumps[:-keep] if keep > 0 else []:
        old.unlink()
        log.info("pruned %s", old.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
