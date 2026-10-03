# Postgres 17 + PostGIS (from the postgis image) + pgvector (added from PGDG apt).
# Neither upstream image ships both, so we layer pgvector on top of PostGIS.
FROM postgis/postgis:17-3.5

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-pgvector \
    && rm -rf /var/lib/apt/lists/*
