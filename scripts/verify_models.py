"""Sprint 0 check: ChatOpenAI + Token Factory base_url against Nano, Super and Ultra,
plus the embedding model's output dimension. Writes the results to docs/models.md.

    uv run python scripts/verify_models.py
"""
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from moby.config import get_settings  # noqa: E402
from moby.llm import EMBEDDING_DIM, EMBEDDING_MODEL, chat_model, embeddings, model_name  # noqa: E402

PROMPT = "Reply with exactly the word OK."


def check_chat(tier: str) -> dict:
    llm = chat_model(tier, temperature=0, max_tokens=512, timeout=120)
    t0 = time.perf_counter()
    try:
        msg = llm.invoke(PROMPT)
    except Exception as e:  # noqa: BLE001 - report every failure mode in the table
        return {"tier": tier, "requested": model_name(tier), "ok": False, "error": f"{type(e).__name__}: {e}"[:200]}
    meta = msg.response_metadata or {}
    usage = msg.usage_metadata or {}
    return {
        "tier": tier,
        "requested": model_name(tier),
        "served": meta.get("model_name", "?"),
        "ok": "OK" in (msg.content or "").upper(),
        "reply": (msg.content or "").strip()[:40],
        "latency_s": round(time.perf_counter() - t0, 2),
        "tokens": f"{usage.get('input_tokens', '?')} in / {usage.get('output_tokens', '?')} out",
    }


def check_embeddings() -> dict:
    t0 = time.perf_counter()
    try:
        vec = embeddings().embed_query("Flash flood warning, Russian River basin")
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}
    norm = sum(v * v for v in vec) ** 0.5
    return {"ok": len(vec) == EMBEDDING_DIM, "dim": len(vec), "norm": round(norm, 3),
            "latency_s": round(time.perf_counter() - t0, 2)}


def main() -> int:
    s = get_settings()
    chats = [check_chat(t) for t in ("nano", "super", "ultra")]
    emb = check_embeddings()

    for c in chats:
        print(c)
    print("embeddings:", emb)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Model strings (verified)",
        "",
        f"Verified {stamp} by `scripts/verify_models.py` against `{s.token_factory_base_url}`",
        "using LangChain `ChatOpenAI(base_url=...)`. Re-run after any model or endpoint change.",
        "",
        "| Plan role | Model string | Served as | Works | Latency | Tokens |",
        "|---|---|---|---|---|---|",
    ]
    roles = {"nano": "Nano 30B — structure_report, draft_alert",
             "super": "Super 120B — fuse_dedup adjudicator",
             "ultra": "Ultra 550B — brief, cascade, guidance corpus, backtests"}
    for c in chats:
        if c.get("error"):
            lines.append(f"| {roles[c['tier']]} | `{c['requested']}` | — | ✗ {c['error']} | — | — |")
        else:
            lines.append(f"| {roles[c['tier']]} | `{c['requested']}` | `{c['served']}` | "
                         f"{'✓' if c['ok'] else '✗ ' + repr(c['reply'])} | {c['latency_s']} s | {c['tokens']} |")
    lines += [
        "",
        "## Embeddings",
        "",
        f"`{EMBEDDING_MODEL}`, requested at **{EMBEDDING_DIM} dimensions** (Matryoshka truncation of the native 4096).",
        "",
    ]
    if emb.get("error"):
        lines.append(f"✗ {emb['error']}")
    else:
        lines.append(f"{'✓' if emb['ok'] else '✗'} returned {emb['dim']} dims, L2 norm {emb['norm']}, {emb['latency_s']} s. "
                     f"Schema column: `reports.embedding vector({EMBEDDING_DIM})` (migration 0003).")
    lines += [
        "",
        "Zero-retention inference is an account setting in the Token Factory console; it cannot be",
        "verified through the API. Confirm it there before any real report text is sent.",
        "",
    ]
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "models.md").write_text("\n".join(lines))
    print("wrote docs/models.md")
    return 0 if all(c.get("ok") for c in chats) and emb.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
