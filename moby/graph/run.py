"""Developer harness: run the fusion graph on ONE pending report and print the path it takes.

    uv run --env-file .env python -m moby.graph.run --list          # pending reports
    uv run --env-file .env python -m moby.graph.run --once          # oldest pending report
    uv run --env-file .env python -m moby.graph.run --once --report-id <uuid>
    uv run --env-file .env python -m moby.graph.run --resume <uuid> --decision approve

Not the production worker (claiming reports with SKIP LOCKED, the loop, resuming decided
review_queue rows): that's yours to build. This only makes each step easy to try.

Contract with your graph (change GRAPH or pass --graph if you name things differently):
  * `moby.graph.fusion.build_graph(checkpointer)` returns a compiled graph
    (`StateGraph(...).compile(checkpointer=checkpointer)`).
  * The input state is `{"report": {...}}`: the reports row as a dict, with `lat`/`lon` floats
    in place of the PostGIS `location`.
  * thread_id = f"report-{report_id}", so --resume finds the paused run.

Checkpointer: in-memory by default, which is all milestones 1–3 need. A paused run only
survives between commands with a persistent checkpointer (--postgres), which needs the
`langgraph-checkpoint-postgres` package (milestone 4).
"""
import argparse
import asyncio
import importlib
import json
import os
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row

GRAPH = "moby.graph.fusion:build_graph"
DEFAULT_DB = "postgresql://moby:moby@localhost:5432/moby"

REPORT_SQL = """
SELECT report_id, client_event_id, event_id, fusion_status, source, reporter_hash, relayed_by,
       hazard_type, observed_effect, severity,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon, location_accuracy_m,
       observed_at, received_at, captured_offline, note, structured
FROM reports
"""


def db_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DB)


def jsonable(row: dict[str, Any]) -> dict[str, Any]:
    """UUIDs and datetimes as strings, so the state is easy to print and to checkpoint."""
    return json.loads(json.dumps(row, default=str))


def fetch_report(report_id: str | None) -> dict[str, Any] | None:
    with psycopg.connect(db_url(), row_factory=dict_row) as conn:
        if report_id:
            row = conn.execute(REPORT_SQL + " WHERE report_id = %s", (report_id,)).fetchone()
        else:
            row = conn.execute(REPORT_SQL + " WHERE fusion_status = 'pending' ORDER BY received_at LIMIT 1").fetchone()
    return jsonable(row) if row else None


def list_pending() -> None:
    with psycopg.connect(db_url(), row_factory=dict_row) as conn:
        rows = conn.execute(REPORT_SQL + " WHERE fusion_status = 'pending' ORDER BY received_at").fetchall()
    if not rows:
        print("no pending reports (seed some: uv run python scripts/seed_reports.py all)")
    for r in rows:
        who = r["reporter_hash"][:12]
        print(f"{r['report_id']}  {r['client_event_id'][:28]:28}  {r['hazard_type']:10} {r['severity']:8} "
              f"{r['source']:6} by {who}  ({r['lat']:.4f}, {r['lon']:.4f})")


def load_builder(spec: str):
    module, _, attr = spec.partition(":")
    try:
        return getattr(importlib.import_module(module), attr or "build_graph")
    except ModuleNotFoundError as e:
        sys.exit(f"Can't import {module} ({e}). Create it with a build_graph(checkpointer) function, "
                 f"or point --graph at yours (module:function).")


def short(value: Any, limit: int = 160) -> str:
    text = json.dumps(value, default=str)
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def run(builder, *, state: dict | None, thread_id: str, resume: Any = None, postgres: bool = False) -> dict:
    """Streams the graph; prints each node's update and any interrupt. Returns the final state."""
    from langgraph.types import Command

    async def go(checkpointer):
        graph = builder(checkpointer)
        config = {"configurable": {"thread_id": thread_id}}
        inp = Command(resume=resume) if resume is not None else state
        print(f"thread {thread_id}")
        async for chunk in graph.astream(inp, config, stream_mode="updates"):
            for node, update in chunk.items():
                if node == "__interrupt__":
                    for intr in update:
                        print(f"  ⏸  paused (interrupt): {short(intr.value)}")
                    print(f"     resume with: python -m moby.graph.run --resume {thread_id.removeprefix('report-')} "
                          f"--decision approve{'' if postgres else ' --postgres  (needs a persistent checkpointer)'}")
                else:
                    keys = ", ".join(f"{k}={short(v, 80)}" for k, v in (update or {}).items()) or "(no changes)"
                    print(f"  → {node}: {keys}")
        snapshot = await graph.aget_state(config)
        return snapshot.values

    if postgres:
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        except ModuleNotFoundError:
            sys.exit("--postgres needs: uv add langgraph-checkpoint-postgres")
        async with AsyncPostgresSaver.from_conn_string(db_url()) as saver:
            await saver.setup()   # creates the checkpoint tables once
            return await go(saver)
    from langgraph.checkpoint.memory import InMemorySaver
    return await go(InMemorySaver())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--list", action="store_true", help="list pending reports")
    g.add_argument("--once", action="store_true", help="run the graph on one report")
    g.add_argument("--resume", metavar="REPORT_ID", help="resume a paused run with --decision")
    p.add_argument("--report-id", help="with --once: this report instead of the oldest pending one")
    p.add_argument("--decision", default="approve", help="with --resume: the value passed to Command(resume=…)")
    p.add_argument("--graph", default=GRAPH, help=f"module:function that builds the graph (default {GRAPH})")
    p.add_argument("--postgres", action="store_true", help="persistent Postgres checkpointer (milestone 4)")
    p.add_argument("--show-state", action="store_true", help="print the final state")
    args = p.parse_args(argv)

    if args.list:
        list_pending()
        return 0
    builder = load_builder(args.graph)
    if args.resume:
        final = asyncio.run(run(builder, state=None, thread_id=f"report-{args.resume}",
                                resume=args.decision, postgres=args.postgres))
    else:
        report = fetch_report(args.report_id)
        if report is None:
            print("no such report" if args.report_id else "no pending reports (seed some first)")
            return 1
        print(f"report {report['report_id']}: {report['hazard_type']} / {report['severity']} "
              f"by {report['reporter_hash'][:12]} ({report['source']})")
        final = asyncio.run(run(builder, state={"report": report}, thread_id=f"report-{report['report_id']}",
                                postgres=args.postgres))
    if args.show_state:
        print(json.dumps(final, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
