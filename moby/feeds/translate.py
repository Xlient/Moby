"""Translate non-English official alerts into English (issue #11).

Plain code on the ingest path (not a LangGraph node). The agency's own words stay in
title/description; the translation goes beside them (title_en/description_en) and the
app always labels it "Translated by Moby" with the original one tap away.

Guardrails:
  - translate only: no summarising, softening or added advice (prompt + checks below);
  - every number in the original (times, levels, depths, km/h…) must appear in the
    translation, otherwise the translation is thrown away and only the original is shown;
  - a translation that comes back empty or much longer than the original is rejected.
"""
import asyncio
import json
import logging
import re
from dataclasses import dataclass

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

log = logging.getLogger("moby.feeds.translate")

BATCH = 20               # per cycle: bounds cost if a feed suddenly floods
INTERVAL_S = 60
CONCURRENCY = 4

PROMPT = """Translate this official emergency warning from {lang} into plain English.

Rules:
- Translate faithfully. Do not summarise, soften, add advice or explain.
- Keep every number, time, date, level and unit exactly as written.
- Keep place names as they are (you may add nothing else).
- If a field is empty, return an empty string for it.

Return ONLY JSON: {{"headline": "...", "body": "..."}}

headline: {headline}
body: {body}"""


@dataclass
class Translation:
    headline: str
    body: str


def numbers(text: str) -> list[str]:
    """Numbers as written, normalising decimal commas (es/it/pt: '2,5' == '2.5')."""
    return [n.replace(",", ".") for n in re.findall(r"\d+(?:[.,]\d+)?", text or "")]


def check(original_headline: str, original_body: str, t: Translation) -> str | None:
    """None if the translation is acceptable, else why not."""
    if not t.headline.strip():
        return "empty headline"
    src = numbers(original_headline + " " + original_body)
    out = numbers(t.headline + " " + t.body)
    missing = [n for n in set(src) if src.count(n) > out.count(n)]
    if missing:
        return f"numbers changed or dropped: {sorted(missing)[:6]}"
    if len(t.body) > 3 * max(80, len(original_body)):
        return "translation far longer than the original"
    return None


def parse(raw: str) -> Translation:
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    return Translation(str(data.get("headline") or "").strip(), str(data.get("body") or "").strip())


async def translate_one(llm, language: str, headline: str, body: str) -> tuple[Translation | None, str | None]:
    msg = PROMPT.format(lang=language, headline=headline or "", body=(body or "")[:3000])
    try:
        resp = await llm.ainvoke(msg)
        t = parse(resp.content if isinstance(resp.content, str) else str(resp.content))
    except Exception as e:  # noqa: BLE001 - model/network/JSON problems all mean "no translation"
        return None, f"{type(e).__name__}: {e}"[:200]
    problem = check(headline or "", body or "", t)
    return (None, problem) if problem else (t, None)


PENDING_SQL = """
SELECT event_id, language, title, description FROM events
WHERE translation_status = 'pending' AND (expires_at IS NULL OR expires_at > now()) AND duplicate_of IS NULL
ORDER BY array_position(ARRAY['critical','high','medium','low'], severity), last_updated_at DESC
LIMIT %s
"""


async def translate_pending(conn: AsyncConnection, llm, model: str) -> dict[str, int]:
    rows = await (await conn.execute(PENDING_SQL, (BATCH,))).fetchall()
    sem = asyncio.Semaphore(CONCURRENCY)

    async def work(row):
        async with sem:
            return row, *(await translate_one(llm, row[1], row[2], row[3]))

    counts = {"done": 0, "failed": 0}
    for (event_id, _lang, _t, _d), t, problem in await asyncio.gather(*(work(r) for r in rows)):
        if t is None:
            counts["failed"] += 1
            log.info("translation rejected for %s: %s", event_id, problem)
            await conn.execute("UPDATE events SET translation_status = 'failed', translation_model = %s "
                               "WHERE event_id = %s AND translation_status = 'pending'", (model, event_id))
        else:
            counts["done"] += 1
            await conn.execute(
                "UPDATE events SET title_en = %s, description_en = %s, translation_status = 'done', "
                "translation_model = %s WHERE event_id = %s AND translation_status = 'pending'",
                (t.headline[:300], t.body[:4000] or None, model, event_id))
    return counts


async def run_translator(pool: AsyncConnectionPool, *, once: bool) -> None:
    from moby.config import get_settings
    from moby.llm import chat_model, model_name

    if get_settings().token_factory_api_key is None:
        log.warning("N_FACTORY_ACC_KEY not set: alerts stay in their original language")
        return
    llm = chat_model("nano", temperature=0, max_tokens=1500)
    model = model_name("nano")
    while True:
        try:
            async with pool.connection() as conn:
                counts = await translate_pending(conn, llm, model)
            if any(counts.values()):
                log.info("translated: %s", counts)
        except Exception:  # noqa: BLE001
            log.exception("translation cycle failed")
        if once:
            return
        await asyncio.sleep(INTERVAL_S)
