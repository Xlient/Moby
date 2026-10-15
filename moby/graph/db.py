"""One connection pool for the graph's nodes and the worker.

Opening a fresh connection for every node call works for one report at a time, but under
a worker it runs the machine out of local ports (each closed connection holds its port in
TIME_WAIT for a while): 296 of 300 back-to-back connects failed in a local test, while a
pool of reused connections served all 300. So nodes borrow from this pool instead.

`with connection() as conn:` behaves like `with psycopg.connect(...) as conn:` did: one
transaction, committed when the block ends (rolled back on an error), then the connection
goes back to the pool. Safe to use from several threads at once.
"""
import threading

from psycopg_pool import ConnectionPool

from moby.config import get_settings

MAX_CONNECTIONS = 10   # the worker runs 4 reports at once, each holding one connection at a time

_pools: dict[str, ConnectionPool] = {}   # one per database URL (tests use a separate database)
_lock = threading.Lock()                 # two threads asking at once must not create two pools


def connection():
    """Borrow a pooled connection: `with connection() as conn: ...`."""
    url = get_settings().database_url
    with _lock:
        pool = _pools.get(url)
        if pool is None:
            pool = _pools[url] = ConnectionPool(url, min_size=1, max_size=MAX_CONNECTIONS, open=True,
                                                name="moby-graph")
    return pool.connection()


def close_pools() -> None:
    """At shutdown: close the pools cleanly (the worker calls this on exit)."""
    with _lock:
        for pool in _pools.values():
            pool.close()
        _pools.clear()
