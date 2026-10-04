"""uv run python -m moby.feeds [--once [--force]] [--feed noaa ...]
   uv run python -m moby.feeds health      # exit 1 if any feed is stale (container healthcheck)
"""
import argparse
import asyncio
import logging
import signal
import sys

from .poller import FEEDS, health, run


async def _run_until_signalled(feeds: list) -> None:
    """Long-running mode: stop cleanly on SIGTERM (docker stop / scheduler) or Ctrl-C.
    Each poll commits atomically, so cancelling mid-poll loses nothing."""
    task = asyncio.ensure_future(run(feeds, once=False))
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, task.cancel)
    try:
        await task
    except asyncio.CancelledError:
        logging.getLogger("moby.feeds").info("stopping")


def main() -> None:
    p = argparse.ArgumentParser(description="Poll official hazard feeds into Postgres.")
    p.add_argument("command", nargs="?", choices=["poll", "health"], default="poll")
    p.add_argument("--once", action="store_true", help="poll each feed once and exit")
    p.add_argument("--feed", action="append", choices=[*FEEDS, "cap"], help="limit to these feeds (repeatable)")
    p.add_argument("--force", action="store_true",
                   help="with --once: ignore ETag/Last-Modified/body hash and re-normalize (after normalizer changes)")
    args = p.parse_args()
    feeds = args.feed or [*FEEDS, "cap"]

    if args.command == "health":
        ok, lines = asyncio.run(health(feeds))
        print("\n".join(lines))
        sys.exit(0 if ok else 1)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if args.force and not args.once:
        p.error("--force only makes sense with --once")
    if args.once:
        asyncio.run(run(feeds, once=True, force=args.force))
    else:
        asyncio.run(_run_until_signalled(feeds))


if __name__ == "__main__":
    main()
