"""The fusion worker (moby/graph/worker.py): batches, failures, shutdown. Test database."""
import asyncio

import pytest

from moby.config import get_settings
from moby.graph import worker
from moby.graph.db import close_pools
from moby.graph.pipeline import build_graph

from .test_graph_queries import conn, db_url, seeded  # noqa: F401 (fixtures)


@pytest.fixture(autouse=True)
def settings(db_url, monkeypatch):  # noqa: F811
    monkeypatch.setenv("DATABASE_URL", db_url)
    get_settings.cache_clear()
    yield
    close_pools()
    get_settings.cache_clear()


class BrokenGraph:
    """Stands in for the graph: every run fails."""
    async def ainvoke(self, state, config):
        raise RuntimeError("model timed out")


def statuses(conn):  # noqa: F811
    return dict(conn.execute("SELECT fusion_status, count(*) FROM reports GROUP BY 1").fetchall())


def test_work_once_fuses_a_batch(conn):  # noqa: F811
    seeded(conn, "corroborated_flood")
    seeded(conn, "far_apart")
    claimed = asyncio.run(worker.work_once(build_graph(None), "test-worker", limit=10))
    assert claimed == 5
    assert statuses(conn) == {"fused": 5}
    assert conn.execute("SELECT count(*) FROM events").fetchone()[0] == 3   # 1 flood + 2 far apart


def test_work_once_respects_the_limit_and_returns_claimed_not_succeeded(conn):  # noqa: F811
    seeded(conn, "corroborated_flood")
    assert asyncio.run(worker.work_once(BrokenGraph(), "test-worker", limit=2)) == 2   # claimed, even though both failed
    assert statuses(conn) == {"pending": 3}


def test_a_failure_is_recorded_and_retried_later(conn):  # noqa: F811
    seeded(conn, "lone_low")
    asyncio.run(worker.work_once(BrokenGraph(), "test-worker", limit=1))
    error, attempts, claimed = conn.execute(
        "SELECT fusion_error, attempts, claimed_at IS NOT NULL FROM reports").fetchone()
    assert error == "RuntimeError: model timed out" and attempts == 1 and claimed   # lease kept: retried after it expires


def test_one_bad_report_does_not_stop_the_others(conn):  # noqa: F811
    seeded(conn, "corroborated_flood")
    real = build_graph(None)

    class SometimesBroken:
        async def ainvoke(self, state, config):
            if state["report"]["reporter_hash"].startswith("seed-carol"):
                raise RuntimeError("bad report")
            return await real.ainvoke(state, config)

    asyncio.run(worker.work_once(SometimesBroken(), "test-worker", limit=10))
    assert statuses(conn) == {"fused": 2, "pending": 1}


def test_run_stops_promptly_when_asked(conn):  # noqa: F811
    async def go():
        stop = asyncio.Event()
        asyncio.get_running_loop().call_later(0.3, stop.set)
        started = asyncio.get_running_loop().time()
        await worker.run(stop)
        return asyncio.get_running_loop().time() - started

    assert asyncio.run(go()) < 1.5      # idle sleep is 2 s, but setting stop wakes it at once


def test_run_processes_everything_pending_then_idles(conn):  # noqa: F811
    seeded(conn, "corroborated_flood")
    seeded(conn, "same_person_thrice")

    async def go():
        stop = asyncio.Event()
        asyncio.get_running_loop().call_later(1.0, stop.set)
        await worker.run(stop, concurrency=2)

    asyncio.run(go())
    assert statuses(conn) == {"fused": 6}
