import asyncio
import logging
import os
import signal
import socket
 
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph.state import CompiledStateGraph
from moby.config import get_settings

from .db import close_pools, connection
from .brief_pipeline import build_brief_graph
from .brief_queries import brief_failed, claim_brief_events, settle_finished_run

log = logging.getLogger("moby.graph.brief_worker")

IDLE_SLEEP_S = 2   
ERROR_SLEEP_S = 10 

def _claim(worker_id: str, limit: int) -> list[dict]:
    with connection() as conn:
        return claim_brief_events(conn, worker_id, limit)

def _record_failure(event_id: str, error: str) -> bool:
    with connection() as conn:
        return brief_failed(conn, event_id, error)

def _settle(event_id: str, requested_at: str) -> str | None:
    with connection() as conn:
        return settle_finished_run(conn, event_id, requested_at)


async def process_brief(graph: CompiledStateGraph , event:dict) -> bool:
    """Run the brief graph on one event. True if it succeeded; on failure, record the error
    (retried after its lease expires, or 'failed' after MAX_ATTEMPTS) and return False."""
    config = {"configurable": {"thread_id": f"brief-{event['event_id']}-{event['brief_requested_at']}"}}
    try:
        snapshot = await graph.aget_state(config)
        if snapshot.next:
            await graph.ainvoke(None, config) # Resume
        elif snapshot.values:
            # The graph already ran to END for this request, but the event is still 'pending'
            # (we crashed after the run, before the status was written). Don't run it again
            # (that would pay twice): set the status from what the run left in the database.
            status = await asyncio.to_thread(_settle, event["event_id"], event["brief_requested_at"])
            log.warning("brief %s: run had already finished; settled as %s", event["event_id"], status)
        else:
            await graph.ainvoke({"event_id": event["event_id"]}, config)
        return True
    except Exception as e:
        log.exception("brief %s failed (attempt %s)", event["event_id"], event.get("brief_attempts"))
        gave_up = await asyncio.to_thread(_record_failure, event["event_id"], f"{type(e).__name__}: {e}")
        if gave_up:
            log.error("brief %s marked failed after too many attempts", event["event_id"])
        return False

async def work_once(graph, worker_id: str, limit: int) -> int:
    """Claim up to `limit` events and process them concurrently. Returns how many were
    CLAIMED (not how many succeeded): the loop uses it to decide whether there's work."""
    events = await asyncio.to_thread(_claim, worker_id, limit)
    if not events:
        return 0
    results = await asyncio.gather(*(process_brief(graph, e) for e in events))
    log.info("processed %d brief(s): %d ok, %d failed", len(events), sum(results), len(events) - sum(results))
    return len(events)

async def _sleep_unless_stopped(stop: asyncio.Event, seconds: float) -> None:
    # Waits on the flag with a timeout: returns at once when stop is set, else after `seconds`.
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        pass  # the normal case: nothing happened, go round again

async def run(stop: asyncio.Event, concurrency: int = 4) -> None:
    """Run the brief worker until `stop` is set. Claim and process events in batches of
    `concurrency`."""
    db_url = get_settings().database_url
    async with AsyncPostgresSaver.from_conn_string(db_url) as saver:
        await saver.setup()
        graph = build_brief_graph(saver)
        worker_id = f"{socket.gethostname()}-{os.getpid()}"
        log.info("brief worker %s started (concurrency %d)", worker_id, concurrency)

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
        log.info("brief worker %s stopped", worker_id)

def main()-> None:
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
