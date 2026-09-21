"""Apply db/migrations/*.sql in filename order. Safe to re-run.

    uv run --env-file .env python scripts/migrate.py

Each migration runs in its own transaction together with its bookkeeping row, so
a failure leaves nothing half-applied. Applied migrations are checksummed: editing
one after the fact is an error -- add a new numbered file instead.
"""
import hashlib
import os
import sys
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "db" / "migrations"
LOCK_ID = 727001  # arbitrary app-wide advisory lock so two runners can't race


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set (try: uv run --env-file .env ...)", file=sys.stderr)
        return 1

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_ID,))
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    text PRIMARY KEY,
                checksum   text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = dict(conn.execute("SELECT version, checksum FROM schema_migrations").fetchall())

        ran = 0
        for path in files:
            sql = path.read_text()
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            if path.name in applied:
                if applied[path.name] != checksum:
                    print(f"ERROR: {path.name} was modified after being applied; add a new migration instead.",
                          file=sys.stderr)
                    return 1
                continue
            with conn.transaction():
                conn.execute(sql)
                conn.execute(
                    "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
                    (path.name, checksum),
                )
            print(f"applied {path.name}")
            ran += 1

        print(f"done: {ran} applied, {len(files) - ran} already up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
