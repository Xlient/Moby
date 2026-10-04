"""Serverless Job: embed events that don't have an embedding yet.

Pulls work from the API, embeds it with Qwen3-Embedding-8B (1024-d) on Token
Factory, and posts the vectors back. Stateless and safe to run any time, any
number of times: it only ever picks rows whose embedding is still NULL.

    MOBY_API_URL=... MOBY_SERVICE_TOKEN=... N_FACTORY_ACC_KEY=... python -m moby.jobs.embed_events
"""
import logging
import os
import sys
import time

import httpx

from moby.llm import EMBEDDING_DIM, embeddings

log = logging.getLogger("moby.jobs.embed")
BATCH = 32
MAX_BATCHES = 200  # hard stop so a bug can't run up a bill


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    api = os.environ["MOBY_API_URL"].rstrip("/")
    headers = {"Authorization": f"Bearer {os.environ['MOBY_SERVICE_TOKEN']}"}
    embedder = embeddings()
    total, t0 = 0, time.perf_counter()

    with httpx.Client(base_url=api, headers=headers, timeout=60) as client:
        for _ in range(MAX_BATCHES):
            resp = client.get("/internal/v1/embedding-queue", params={"limit": BATCH})
            resp.raise_for_status()
            queue = resp.json()
            if queue["dimensions"] != EMBEDDING_DIM:
                log.error("dimension mismatch: API %s vs job %s", queue["dimensions"], EMBEDDING_DIM)
                return 1
            items = queue["items"]
            if not items:
                break
            vectors = embedder.embed_documents([i["text"] for i in items])
            client.post(
                "/internal/v1/embeddings",
                json=[{"event_id": i["event_id"], "embedding": v} for i, v in zip(items, vectors, strict=True)],
            ).raise_for_status()
            total += len(items)
            log.info("embedded %d (total %d)", len(items), total)

    log.info("done: %d events embedded in %.1f s", total, time.perf_counter() - t0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
