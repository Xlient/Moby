"""Ask Moby: a safety assistant that only answers from sources it can cite.

    question → sources → Nemotron Super answer (cited) → grounding checks → app

Sources, in order of trust:
  1. Active official alerts near the user (when the app sends a location).
  2. Moby's guidance cards, checked against official pages (Qwen3 embeddings + pgvector).
  3. Only when those don't cover it: a Tavily search restricted to the country's official
     domains (moby/search/official.py). Nemotron Nano first rewrites the question into a
     generic query, so names, addresses or other personal details never reach the search.

Safety:
  - Super answers ONLY from the numbered sources and cites them; it abstains otherwise.
  - Every number in the answer must appear in a cited source, and most of its words must
    too. If not, the answer is dropped and the app says it couldn't find one.
  - Never decides urgency, never says a place is safe. The app always shows the local
    emergency numbers next to the answer.
  - Questions aren't stored or traced (they may contain personal details).
"""
import asyncio
import json
import logging
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from functools import cache

from langsmith import tracing_context
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from moby.alerts.preferences import AlertPreferences, alerts_near
from moby.api.alerts import to_alert
from moby.search.official import OFFICIAL

from . import budget, localize
from .grounding import stray_numbers, support

log = logging.getLogger("moby.ai.ask")

MAX_CARDS = 4
CARD_MIN_SIMILARITY = 0.5        # measured: on-topic questions 0.54-0.71, off-topic 0.39-0.49
WEB_WHEN_BEST_BELOW = 0.65       # search official websites when no card is this close
ALERT_RADIUS_KM = 50
MIN_ANSWER_SUPPORT = 0.5
RATE_LIMIT = 20                  # questions per user per hour
INDEX_INTERVAL_S = 600

# Qwen3-Embedding is instruction-aware: queries get an instruction, documents don't.
QUERY_INSTRUCTION = ("Instruct: Given a question about staying safe in a natural hazard, "
                     "retrieve safety guidance that answers it\nQuery: ")

QUERY_PROMPT = """Rewrite this question as a short English web search query (at most 12 words) about the
safety topic only. Remove names, addresses, phone numbers, and any other personal details.
Return only the query.

Question: {question}"""

ANSWER_PROMPT = """You are Moby, a hazard-safety assistant. Answer the question using ONLY the numbered sources.

Rules:
- If the sources don't answer it, return {{"abstain": true}}. Don't guess or use outside knowledge.
- At most 120 words, plain language. Cite the sources you use inline, like [1] or [2].
- Never say a place, route or action is safe, or that a danger has passed, unless a source says so.
- Only use numbers that appear in the sources. Don't give phone numbers (the app shows them).
- Write the answer in English, whatever language the question is in (it is translated for the reader afterwards).

Return ONLY JSON: {{"answer": "...", "citations": [1, 2], "abstain": false}}

Question:
<<<
{question}
>>>

Sources:
{sources}"""


@dataclass
class Source:
    kind: str            # 'alert' | 'guidance' | 'web'
    title: str
    publisher: str
    url: str | None
    text: str


# ── Rate limit (per process: the endpoint runs one API container) ────────────

_asked: dict[str, deque[float]] = defaultdict(deque)


def allow(uid: str, now: float | None = None) -> bool:
    now = time.monotonic() if now is None else now
    q = _asked[uid]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return False
    q.append(now)
    return True


# ── Sources ─────────────────────────────────────────────────────────────────

@cache
def _models():
    from moby.llm import chat_model, embeddings, model_name

    return {
        "embed": embeddings(),
        "nano": chat_model("nano", temperature=0, max_tokens=200),
        # Super reasons before answering: leave room for the JSON after it.
        "super": chat_model("super", temperature=0, max_tokens=3000),
        "super_name": model_name("super"),
    }


async def alert_sources(conn: AsyncConnection, lat: float, lon: float) -> list[Source]:
    rows = await alerts_near(conn, lat, lon, ALERT_RADIUS_KM, AlertPreferences.from_dict({}), min_tier=2)
    out = []
    for row in rows[:3]:
        a = to_alert(row)
        if a.get("body"):
            out.append(Source("alert", a["headline"], a.get("source_attribution") or "Official alert", None,
                              a["body"]))
    return out


async def card_sources(conn: AsyncConnection, vector: list[float]) -> list[tuple[Source, float]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """SELECT c.title, c.applies_when, c.body, c.source_name, c.source_url,
                      1 - (c.embedding <=> %(v)s::vector) AS similarity
               FROM guidance_cards c JOIN guidance_bundles b USING (bundle_id)
               WHERE b.status = 'published' AND c.embedding IS NOT NULL
               ORDER BY c.embedding <=> %(v)s::vector LIMIT %(n)s""",
            {"v": str(vector), "n": MAX_CARDS})
        rows = await cur.fetchall()
    return [(Source("guidance", r["title"], r["source_name"], r["source_url"],
                    f"{r['applies_when'] or ''}\n{r['body']}".strip()), float(r["similarity"]))
            for r in rows if r["similarity"] >= CARD_MIN_SIMILARITY]


def _domain(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0]


async def web_sources(pool: AsyncConnectionPool, question: str,
                      country: str | None) -> tuple[list[Source], str | None, bool]:
    """Official websites via Tavily: (sources, the query searched, whether today's search
    allowance stopped it). ([], None, False) when there's no domain list or no key."""
    domains = OFFICIAL.get(country or "")
    if not domains:
        return [], None, False
    from moby.search.tavily import Tavily, TavilyNotConfigured

    try:
        tavily = Tavily(timeout=10)
    except TavilyNotConfigured:
        return [], None, False
    async with pool.connection() as conn:
        # Ask Moby's own allowance: briefs and trip briefings use `tavily`, so they can't use it up.
        if not await budget.take(conn, "ask_search"):
            return [], None, True
    query = (await _models()["nano"].ainvoke(QUERY_PROMPT.format(question=question))).content
    query = str(query).strip().strip('"')[:150]
    try:
        results = await asyncio.to_thread(tavily.search, query, include_domains=domains, max_results=3)
    except Exception as e:  # noqa: BLE001 - search is optional; answer from what we have
        log.warning("Tavily search failed: %s", type(e).__name__)
        return [], query, False
    return [Source("web", r.title or _domain(r.url), _domain(r.url), r.url, r.content[:1500])
            for r in results if r.content], query, False


# ── Answer and check ────────────────────────────────────────────────────────

def parse(raw: str) -> dict:
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    cites = [int(c) for c in (data.get("citations") or []) if str(c).strip().isdigit()]
    return {"answer": str(data.get("answer") or "").strip(), "citations": cites,
            "abstain": bool(data.get("abstain"))}


def check(out: dict, sources: list[Source]) -> str | None:
    """None if the answer is grounded in the sources it cites, else why not."""
    if out["abstain"] or not out["answer"]:
        return "abstained"
    cited = {c for c in out["citations"] if 1 <= c <= len(sources)}
    cited |= {int(m) for m in re.findall(r"\[(\d+)\]", out["answer"]) if 1 <= int(m) <= len(sources)}
    if not cited:
        return "no valid citations"
    if len(out["answer"]) > 1000:
        return "answer too long"
    text = re.sub(r"\[\d+\]", "", out["answer"])
    cited_text = "\n".join(f"{sources[c - 1].title}\n{sources[c - 1].text}" for c in cited)
    if stray := stray_numbers(text, cited_text):
        return f"numbers not in the sources: {stray}"
    if support(text, cited_text) < MIN_ANSWER_SUPPORT:
        return "answer strays from its sources"
    out["citations"] = sorted(cited)
    return None


def _numbered(sources: list[Source]) -> str:
    label = {"alert": "official alert", "guidance": "official guidance", "web": "official website"}
    return "\n\n".join(f"[{i}] ({label[s.kind]}) {s.title} — {s.publisher}\n{s.text}"
                       for i, s in enumerate(sources, 1))


async def answer(pool: AsyncConnectionPool, question: str, *, lat: float | None = None,
                 lon: float | None = None, country: str | None = None, language: str | None = None) -> dict:
    m = _models()
    with tracing_context(enabled=False):      # questions may contain personal details
        vector = await m["embed"].aembed_query(QUERY_INSTRUCTION + question)
        async with pool.connection() as conn:   # released before the slow model calls
            alerts = await alert_sources(conn, lat, lon) if lat is not None and lon is not None else []
            cards = await card_sources(conn, vector)
        sources = alerts + [s for s, _ in cards]
        web, query, limited = [], None, False
        if not cards or cards[0][1] < WEB_WHEN_BEST_BELOW:
            web, query, limited = await web_sources(pool, question, country)
            sources += web
        # search_limited: a web search would have run but today's allowance is used up, so the
        # app can say why when Moby can't answer, instead of a plain "I can't answer that".
        result = {"answer": None, "abstained": True, "sources": [], "model": m["super_name"],
                  "searched_web": query is not None, "search_limited": limited, "language": "en"}
        if limited:
            log.info("ask: today's search allowance is used up; answering from alerts and guidance only")
        if not sources:
            return result
        try:
            resp = await m["super"].ainvoke(ANSWER_PROMPT.format(question=question, sources=_numbered(sources)))
            out = parse(resp.content if isinstance(resp.content, str) else str(resp.content))
        except Exception as e:  # noqa: BLE001 - model, network or JSON problems all mean "no answer"
            log.info("ask failed: %s", type(e).__name__)
            return result
    if problem := check(out, sources):
        log.info("answer withheld: %s", problem)
        return result
    # Renumber so the app's [n] markers match the cited list it receives.
    renumber = {old: new for new, old in enumerate(out["citations"], 1)}
    text = re.sub(r"\[(\d+)\]", lambda g: f"[{renumber[int(g[1])]}]" if int(g[1]) in renumber else "",
                  out["answer"])
    cited = [sources[c - 1] for c in out["citations"]]
    # Checked in English; now in the reader's language if we can (numbers and [n] markers kept).
    if (code := localize.normalize(language)) and (llm := localize.nano()):
        async with pool.connection() as conn:
            allowed = await budget.take(conn, "localize")
        if allowed and (loc := await localize.localize(llm, {"answer": text}, code)):
            text, result = loc["answer"], result | {"language": code}
    return result | {
        "answer": text, "abstained": False,
        "sources": [{"n": i, "kind": s.kind, "title": s.title[:200], "publisher": s.publisher, "url": s.url}
                    for i, s in enumerate(cited, 1)],
    }


# ── Index guidance cards (new bundles get embedded within minutes) ──────────

async def index_cards(conn: AsyncConnection, embedder, limit: int = 64) -> int:
    rows = await (await conn.execute(
        "SELECT bundle_id, card_id, title, applies_when, body FROM guidance_cards "
        "WHERE embedding IS NULL LIMIT %s", (limit,))).fetchall()
    if not rows:
        return 0
    vectors = await embedder.aembed_documents([f"{t}\n{w or ''}\n{b}" for _, _, t, w, b in rows])
    async with conn.cursor() as cur:
        await cur.executemany("UPDATE guidance_cards SET embedding = %s::vector WHERE bundle_id = %s AND card_id = %s",
                              [(str(v), r[0], r[1]) for r, v in zip(rows, vectors, strict=True)])
    return len(rows)


async def run_card_indexer(pool: AsyncConnectionPool, *, once: bool) -> None:
    from moby.config import get_settings

    if get_settings().token_factory_api_key is None:
        return
    embedder = _models()["embed"]
    while True:
        try:
            async with pool.connection() as conn:
                if n := await index_cards(conn, embedder):
                    log.info("indexed %d guidance cards for Ask Moby", n)
        except Exception:  # noqa: BLE001
            log.exception("guidance indexing failed")
        if once:
            return
        await asyncio.sleep(INDEX_INTERVAL_S)
