"""uv run python -m moby.delivery [--once] [--dry-run]

Runs the delivery worker every INTERVAL seconds next to the poller. Without
FIREBASE_SERVICE_ACCOUNT_JSON it runs dry: logs what it would push, sends nothing,
and records nothing (so nothing is lost once credentials arrive).
"""
import argparse
import asyncio
import logging
import os
import signal

from moby.db import make_pool

from .fcm import FcmSender, Push, Result
from .worker import deliver_once

INTERVAL = 30
log = logging.getLogger("moby.delivery")


class DryRun:
    def send(self, push: Push) -> Result:
        log.info("dry run, would push: %s | %s", push.title, push.body[:80])
        return Result("failed", "dry run")


async def run(once: bool, dry: bool) -> None:
    creds = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if dry or not creds:
        if not dry:
            log.warning("FIREBASE_SERVICE_ACCOUNT_JSON not set: not sending pushes")
        sender, record = DryRun(), False
    else:
        sender, record = FcmSender(creds), True
    async with make_pool(max_size=2) as pool:
        while True:
            try:
                async with pool.connection() as conn:
                    if record:
                        await deliver_once(conn, sender)
                    else:
                        # Roll back so dry runs never write delivery rows.
                        async with conn.transaction(force_rollback=True):
                            await deliver_once(conn, sender)
            except Exception:
                log.exception("delivery cycle failed")
            if once:
                return
            await asyncio.sleep(INTERVAL)


def main() -> None:
    p = argparse.ArgumentParser(description="Push tier-2 events to subscribed devices.")
    p.add_argument("--once", action="store_true", help="one pass, then exit")
    p.add_argument("--dry-run", action="store_true", help="log pushes instead of sending them")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    async def guarded():
        task = asyncio.ensure_future(run(args.once, args.dry_run))
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, task.cancel)
        try:
            await task
        except asyncio.CancelledError:
            log.info("stopping")

    asyncio.run(guarded())


if __name__ == "__main__":
    main()
