"""Postgres access (psycopg 3, async pool)."""
from psycopg_pool import AsyncConnectionPool

from moby.config import get_settings


def make_pool(min_size: int = 1, max_size: int = 4) -> AsyncConnectionPool:
    """Caller owns the pool: `async with make_pool() as pool: ...`."""
    return AsyncConnectionPool(get_settings().database_url, min_size=min_size, max_size=max_size, open=False)
