#!/usr/bin/env bash
# Supervisor for the all-in-one endpoint container:
#   1. Postgres (data in $PGDATA on the persistent volume; listens on 127.0.0.1 only)
#   2. migrations (idempotent)
#   3. feed poller (restarted if it ever exits)
#   4. API (uvicorn) — the container's main process; if it dies, the container exits
#      and the platform restarts it.
# SIGTERM stops the API and poller, then shuts Postgres down cleanly.
set -euo pipefail

log() { echo "$(date -u +%FT%TZ) start.sh: $*"; }

# ── 1. Postgres ──────────────────────────────────────────────────────────────
mkdir -p /run/postgresql
chown postgres:postgres /run/postgresql

# The persistent volume (/data) is a Nebius shared filesystem mounted as root. Postgres
# runs unprivileged and must own its data directory, so make the mount traversable and
# hand PGDATA to the postgres user — then verify it worked, because some filesystems
# silently ignore chown.
prepare_pgdata() {
  local dir="$1"
  mkdir -p "$dir" || return 1
  chmod 755 "$(dirname "$dir")" 2>/dev/null || true
  chown -R postgres:postgres "$dir" 2>/dev/null || true
  chmod 700 "$dir" 2>/dev/null || true
  runuser -u postgres -- test -w "$dir" && [ "$(stat -c %U "$dir")" = postgres ]
}

if ! prepare_pgdata "$PGDATA"; then
  log "WARNING: $PGDATA is not usable by postgres on this volume:"
  ls -ld "$(dirname "$PGDATA")" "$PGDATA" 2>&1 | sed 's/^/  /'
  # Keep the service up rather than crash-looping: official feed data re-ingests within
  # minutes. Surfaced in /healthz as storage=ephemeral so it can't go unnoticed.
  PGDATA=/var/lib/postgresql/moby-data
  export PGDATA MOBY_STORAGE=ephemeral
  log "WARNING: falling back to NON-PERSISTENT storage at $PGDATA (data lost on restart)"
  prepare_pgdata "$PGDATA" || { log "cannot prepare any data directory"; exit 1; }
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initialising a new database cluster in $PGDATA"
  # Local-only cluster: nothing outside this container can connect (port 5432 is
  # not exposed), so trust auth on loopback is safe and avoids a stored password.
  runuser -u postgres -- initdb -D "$PGDATA" --username=postgres --auth-local=trust --auth-host=trust \
    --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "shared_buffers = 1GB"            # sized for the 8 GB preset
    echo "effective_cache_size = 4GB"
    echo "max_connections = 40"
  } >> "$PGDATA/postgresql.conf"
fi

runuser -u postgres -- pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -w -t 120 start
psql -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='moby'" | grep -q 1 \
  || psql -U postgres -h 127.0.0.1 -c "CREATE ROLE moby LOGIN"
psql -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_database WHERE datname='moby'" | grep -q 1 \
  || psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE moby OWNER moby"
# Extensions need superuser on a fresh cluster; migrations then see them as present.
psql -U postgres -h 127.0.0.1 -d moby -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

stop_all() {
  log "stopping"
  kill "${API_PID:-}" "${POLLER_LOOP_PID:-}" 2>/dev/null || true
  wait "${API_PID:-}" 2>/dev/null || true
  runuser -u postgres -- pg_ctl -D "$PGDATA" -m fast -w stop || true
  exit 0
}
trap stop_all TERM INT

# ── 2. Migrations ────────────────────────────────────────────────────────────
runuser -u moby -- python /app/scripts/migrate.py

# ── 3. Poller (kept alive) ───────────────────────────────────────────────────
(
  while true; do
    runuser -u moby -- python -m moby.feeds || log "poller exited ($?); restarting in 10s"
    sleep 10
  done
) &
POLLER_LOOP_PID=$!

# ── 4. API ───────────────────────────────────────────────────────────────────
runuser -u moby -- uvicorn moby.api.app:app --host 0.0.0.0 --port "$PORT" --proxy-headers &
API_PID=$!
log "running: postgres + poller + api on :$PORT"
wait "$API_PID"
log "api exited; shutting down so the platform restarts the container"
stop_all
