# Backend image: the feed poller today; the FastAPI app and graph workers later.
#   docker build -t moby-backend .
#   docker run --env-file .env moby-backend                       # poll forever
#   docker run --env-file .env moby-backend python -m moby.feeds --once
# Official Python image from Docker Hub (ghcr.io is unreliable from some networks);
# uv comes from PyPI, pinned to the version the lockfile was written with.
FROM python:3.14-slim

RUN pip install --no-cache-dir "uv==0.11.8"

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Dependencies first (cached layer), exactly as locked in uv.lock.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-install-project

COPY moby ./moby
COPY scripts ./scripts
COPY db ./db
COPY legal ./legal

# Never run as root.
RUN useradd --system --uid 10001 moby
USER moby

HEALTHCHECK --interval=60s --timeout=15s --start-period=120s --retries=2 \
    CMD ["python", "-m", "moby.feeds", "health"]

CMD ["python", "-m", "moby.feeds"]
