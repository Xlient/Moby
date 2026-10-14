"""'What this means for you': plain-language explanations of official warnings.

Official warnings are often dense ("...FLOOD WARNING REMAINS IN EFFECT FOR THE RUSSIAN
RIVER AT GUERNEVILLE..."). Nemotron Super rewrites the agency's own text into two or
three plain sentences plus up to three actions *taken from that text*.

Safety:
  - Input is only the agency's text (or Moby's checked translation of it). No web, no guessing.
  - Every number in the output must appear in the agency's text, and most of each action's
    words must too; otherwise the explanation is discarded and the app shows the original.
  - Times, dates and distances are left out: the app shows those itself from the data.
  - Labelled "Explained by Moby AI" in the app, with the official text right below.
  - Generated on first view and cached per event: one model call serves every reader.
"""
import asyncio
import json
import logging
import re
from datetime import datetime, timezone

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from .grounding import stray_numbers, support

log = logging.getLogger("moby.ai.explain")

BATCH = 10
INTERVAL_S = 15
MIN_ACTION_SUPPORT = 0.6
MIN_SUMMARY_SUPPORT = 0.45      # plain language may use simpler words than the agency

PROMPT = """You explain an official hazard warning to a member of the public, in plain English.

Rules:
- Use ONLY the warning text below. Do not add facts, causes, forecasts or advice it doesn't contain.
- summary: 2-3 short sentences: what is happening and how serious it is. No jargon, no ALL CAPS.
- actions: up to 3 short instructions, ONLY ones the warning itself gives. Empty list if it gives none.
- Do NOT mention times, dates, or distances (the app shows them). Keep any other numbers exactly as written.
- Never say it's safe or that the danger has passed unless the warning says so.

Return ONLY JSON: {{"summary": "...", "actions": ["...", "..."]}}

Hazard: {hazard}  Severity: {severity}  Area: {area}
Warning title: {title}
Warning text:
<<<
{text}
>>>"""


def source_text(row: dict) -> tuple[str, str]:
    """(title, text) to explain: Moby's checked English translation when there is one."""
    translated = row.get("translation_status") == "done" and row.get("title_en")
    title = (row.get("title_en") if translated else row.get("title")) or row.get("product") or ""
    text = (row.get("description_en") if translated else row.get("description")) or ""
    # NWS keeps its "what to do" in a separate field; CAP descriptions already include it.
    instruction = ((row.get("raw_payload") or {}).get("properties") or {}).get("instruction")
    if instruction and not translated and instruction not in text:
        text = f"{text}\n\nInstructions: {instruction}"
    return title, text[:6000]


def parse(raw: str) -> dict:
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    actions = [str(a).strip() for a in (data.get("actions") or []) if str(a).strip()][:3]
    return {"summary": str(data.get("summary") or "").strip(), "actions": actions}


def check(out: dict, title: str, text: str) -> str | None:
    """None if grounded in the agency's text, else why not."""
    source = f"{title}\n{text}"
    if not out["summary"] or len(out["summary"]) > 600:
        return "summary empty or too long"
    stray = stray_numbers(out["summary"] + " " + " ".join(out["actions"]), source)
    if stray:
        return f"numbers not in the warning: {stray}"
    if support(out["summary"], source) < MIN_SUMMARY_SUPPORT:
        return "summary strays from the warning"
    for a in out["actions"]:
        if support(a, source) < MIN_ACTION_SUPPORT:
            return f"action not in the warning: {a[:60]!r}"
    return None


async def explain_one(llm, row: dict) -> tuple[dict | None, str | None]:
    title, text = source_text(row)
    if len(text) < 40:
        return None, "too little official text to explain"
    area = ((row.get("raw_payload") or {}).get("properties") or {}).get("areaDesc") or ""
    msg = PROMPT.format(hazard=row["hazard_type"], severity=row["severity"], area=str(area)[:200],
                        title=title[:300], text=text)
    try:
        resp = await llm.ainvoke(msg)
        out = parse(resp.content if isinstance(resp.content, str) else str(resp.content))
    except Exception as e:  # noqa: BLE001 - model, network or JSON problems all mean "no explanation"
        return None, f"{type(e).__name__}: {e}"[:200]
    problem = check(out, title, text)
    return (None, problem) if problem else (out, None)


PENDING_SQL = """
SELECT event_id, hazard_type, severity, title, description, product, raw_payload,
       title_en, description_en, translation_status
FROM events
WHERE explainer_status = 'pending' AND translation_status <> 'pending'   -- explain the translation once ready
ORDER BY last_updated_at DESC LIMIT %s
"""


async def explain_pending(conn: AsyncConnection, llm, model: str) -> dict[str, int]:
    from psycopg.rows import dict_row

    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(PENDING_SQL, (BATCH,))
        rows = await cur.fetchall()
    results = await asyncio.gather(*(explain_one(llm, r) for r in rows))
    counts = {"done": 0, "failed": 0}
    for row, (out, problem) in zip(rows, results, strict=True):
        if out is None:
            counts["failed"] += 1
            log.info("explanation rejected for %s: %s", row["event_id"], problem)
            await conn.execute("UPDATE events SET explainer_status = 'failed' WHERE event_id = %s",
                               (row["event_id"],))
        else:
            counts["done"] += 1
            out |= {"model": model, "generated_at": datetime.now(timezone.utc).isoformat()}
            await conn.execute("UPDATE events SET explainer = %s, explainer_status = 'done' WHERE event_id = %s",
                               (Jsonb(out), row["event_id"]))
    return counts


async def run_explainer(pool: AsyncConnectionPool, *, once: bool) -> None:
    from moby.config import get_settings
    from moby.llm import chat_model, model_name

    if get_settings().token_factory_api_key is None:
        log.warning("N_FACTORY_ACC_KEY not set: no plain-language explanations")
        return
    # Super reasons before answering (~600 reasoning tokens here): leave room for the JSON.
    llm = chat_model("super", temperature=0, max_tokens=3000)
    model = model_name("super")
    while True:
        try:
            async with pool.connection() as conn:
                counts = await explain_pending(conn, llm, model)
            if any(counts.values()):
                log.info("explained: %s", counts)
        except Exception:  # noqa: BLE001
            log.exception("explanation cycle failed")
        if once:
            return
        await asyncio.sleep(INTERVAL_S)
