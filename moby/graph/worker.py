"""Fusion worker: runs the graph on pending reports, forever, safely alongside other workers.

    uv run --env-file .env python -m moby.graph.worker

Each round: claim a batch of reports (a lease, see queries.claim_reports), run the graph
on them concurrently, record failures. Sleeps briefly when there's nothing to do. SIGTERM
or Ctrl+C stops it after the current batch. If it's killed mid-batch, nothing is lost: the
leases expire and another run picks the reports up (every node is safe to repeat).
"""
import asyncio
import logging
import os
import signal
import socket

from .db import close_pools, connection
from .pipeline import build_graph
from .queries import claim_reports, report_failed

log = logging.getLogger("moby.graph.worker")

IDLE_SLEEP_S = 2      # nothing pending: check again after this
ERROR_SLEEP_S = 10    # the database is unreachable: back off before retrying


# ── Sync helpers: each borrows a pooled connection and runs in a thread (asyncio.to_thread),
# because psycopg's queries block, and blocking the event loop would stall every other
# report in flight.

def _claim(worker_id: str, limit: int) -> list[dict]:
    # `with` commits when the block ends: the claim (the lease) takes effect before any
    # graph runs, so other workers skip these reports.
    with connection() as conn:
        return claim_reports(conn, worker_id, limit)


def _record_failure(report_id: str, error: str) -> bool:
    with connection() as conn:
        return report_failed(conn, report_id, error)


async def process_report(graph, report: dict) -> bool:
    """Run the graph on one report. True if it succeeded; on failure, record the error
    (retried after its lease expires, or 'failed' after MAX_ATTEMPTS) and return False."""
    config = {"configurable": {"thread_id": f"report-{report['report_id']}"}}
    try:
        await graph.ainvoke({"report": report}, config)
        return True
    except Exception as e:
        # %s, not %d: report_id is a UUID string. log.exception adds the traceback itself.
        log.exception("report %s failed (attempt %s)", report["report_id"], report.get("attempts"))
        # str(e): the column is text; an exception object can't be stored.
        gave_up = await asyncio.to_thread(_record_failure, report["report_id"], f"{type(e).__name__}: {e}")
        if gave_up:
            log.error("report %s marked failed after too many attempts", report["report_id"])
        return False


async def work_once(graph, worker_id: str, limit: int) -> int:
    """Claim up to `limit` reports and process them concurrently. Returns how many were
    CLAIMED (not how many succeeded): the loop uses it to decide whether there's work."""
    reports = await asyncio.to_thread(_claim, worker_id, limit)
    if not reports:
        return 0
    results = await asyncio.gather(*(process_report(graph, r) for r in reports))
    log.info("processed %d report(s): %d ok, %d failed", len(reports), sum(results), len(reports) - sum(results))
    return len(reports)


async def _sleep_unless_stopped(stop: asyncio.Event, seconds: float) -> None:
    # Waits on the flag with a timeout: returns at once when stop is set, else after `seconds`.
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        pass  # the normal case: nothing happened, go round again


async def run(stop: asyncio.Event, concurrency: int = 4) -> None:
    """Run the worker until `stop` is set."""
    # No checkpointer: a failed report is rerun from the start and every node is safe to
    # repeat, so there's nothing to resume. (An InMemorySaver would also keep every
    # report's state in memory forever in a long-running process.)
    graph = build_graph(None)
    # One id per PROCESS, worked out once: the host (two machines can share a pid) + the pid.
    worker_id = f"{socket.gethostname()}-{os.getpid()}"
    log.info("fusion worker %s started (concurrency %d)", worker_id, concurrency)
    while not stop.is_set():
        try:
            claimed = await work_once(graph, worker_id, concurrency)
        except Exception:
            # e.g. the database is down: don't crash, back off and try again.
            log.exception("worker round failed; retrying in %ss", ERROR_SLEEP_S)
            await _sleep_unless_stopped(stop, ERROR_SLEEP_S)
            continue
        if claimed == 0:
            await _sleep_unless_stopped(stop, IDLE_SLEEP_S)
    log.info("fusion worker %s stopped", worker_id)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    async def start() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stop.set)   # graceful: finish the batch, then exit
        try:
            await run(stop)
        finally:
            close_pools()   # hand the connections back to Postgres cleanly

    asyncio.run(start())


if __name__ == "__main__":
    main()
