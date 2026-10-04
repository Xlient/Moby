# Postgres 17 + pgvector (official multi-arch image) + PostGIS (from PGDG apt).
# Neither upstream image ships both. We start from pgvector because postgis/postgis
# has no arm64 build (Apple Silicon); pgvector/pgvector is multi-arch and already
# has the PGDG apt repo configured, so PostGIS is a single package install.
FROM pgvector/pgvector:pg17

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
