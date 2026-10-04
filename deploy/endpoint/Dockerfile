# All-in-one image for the Nebius Serverless Endpoint (docs/deploy.md):
#   Postgres 17 + PostGIS + pgvector   (data under /data — mount a persistent volume there)
#   migrations, feed poller, FastAPI   (start.sh supervises them)
# Nebius Managed PostgreSQL has no PostGIS, and one small CPU VM for everything is
# the cheapest always-on option (~$48/month on cpu-d3 2vcpu-8gb).
#
#   docker build -f deploy/endpoint/Dockerfile -t moby-endpoint .
#   docker run -p 8000:8000 -v moby-endpoint-data:/data -e MOBY_SERVICE_TOKEN=... moby-endpoint
FROM python:3.14-slim

ARG PG_MAJOR=17
ENV PG_MAJOR=${PG_MAJOR} \
    PATH="/usr/lib/postgresql/${PG_MAJOR}/bin:/app/.venv/bin:$PATH" \
    PGDATA=/data/pgdata \
    DATABASE_URL=postgresql://moby@127.0.0.1:5432/moby \
    PORT=8000 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1 PYTHONUNBUFFERED=1

# PostgreSQL + PostGIS + pgvector from the PostgreSQL project's own apt repository.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg lsb-release \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql-${PG_MAJOR} postgresql-${PG_MAJOR}-postgis-3 postgresql-${PG_MAJOR}-pgvector \
    && apt-get purge -y gnupg lsb-release && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "uv==0.11.8"

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-install-project
COPY moby ./moby
COPY scripts ./scripts
COPY db ./db
COPY legal ./legal
COPY deploy/endpoint/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh && useradd --system --uid 10001 --home /app moby

EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=10s --start-period=180s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

# Starts as root only to prepare /data; every process then runs unprivileged.
CMD ["/usr/local/bin/start.sh"]
