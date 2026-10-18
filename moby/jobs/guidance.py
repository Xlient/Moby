"""Serverless Job: build a draft bundle of offline guidance cards (plan v3 §8.1).

For each official page in SOURCES[country], Nemotron Ultra turns the page's own text into a
few short cards. The page is given to the model as numbered lines, and each card must cite the
lines it is based on. A card is kept only if it survives grounding checks:

  - it cites real lines (its evidence is those lines, so quotes are verbatim by construction),
  - most of its content words appear in the cited lines (no invented advice),
  - every number in it (distances, depths, minutes...) appears in the cited lines,
  - it has the fields and lengths the contract requires.

Cards are always in English. A page in another language is first translated literally,
line by line, and the cards are written from those English lines: the word check runs
against the translation, numbers against the original lines.

Anything that fails is dropped and logged, never "fixed". The surviving cards are
posted as a *draft* bundle; a reviewer reads them (with their evidence) and
publishes. Plain Python by design — not a LangGraph node.

    MOBY_API_URL=... MOBY_SERVICE_TOKEN=... N_FACTORY_ACC_KEY=... python -m moby.jobs.guidance [--country CN] [--hazard earthquake] [--dry-run] [--fetcher tavily]
"""
import argparse
import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser

import httpx

from moby.llm import chat_model, model_name

log = logging.getLogger("moby.jobs.guidance")

HAZARDS = ("flood", "fire", "earthquake", "storm", "landslide", "other")


@dataclass(frozen=True)
class Source:
    hazard: str
    name: str
    url: str
    lang: str = "en"   # the page's language; cards are always English (see translate_lines)


# Official pages only, per country (moby/search/official.py lists each country's official
# domains). Each card cites exactly one of these. A page joins a list only after a person
# has read it: scripts/discover_guidance_sources.py finds candidates, it never adds them.
# (The Red Cross and China Earthquake Administration pages refuse automated fetches with
# 403, so they aren't listed; we don't work around that.)
SOURCES: dict[str, list[Source]] = {
    "US": [
        Source("flood", "FEMA Ready.gov", "https://www.ready.gov/floods"),
        Source("flood", "National Weather Service", "https://www.weather.gov/safety/flood-turn-around-dont-drown"),
        Source("earthquake", "FEMA Ready.gov", "https://www.ready.gov/earthquakes"),
        Source("fire", "FEMA Ready.gov", "https://www.ready.gov/wildfires"),
        Source("storm", "FEMA Ready.gov", "https://www.ready.gov/tornadoes"),
        Source("storm", "National Weather Service", "https://www.weather.gov/safety/tornado-during"),
        Source("storm", "FEMA Ready.gov", "https://www.ready.gov/hurricanes"),
        Source("storm", "FEMA Ready.gov", "https://www.ready.gov/thunderstorms-lightning"),
        Source("storm", "National Weather Service", "https://www.weather.gov/safety/lightning-safety-overview"),
        Source("landslide", "FEMA Ready.gov", "https://www.ready.gov/landslides-debris-flow"),
        Source("other", "FEMA Ready.gov", "https://www.ready.gov/power-outages"),
    ],
    # Checked 2026-10-18. MEM = Ministry of Emergency Management (its 应急科普 public-safety
    # pages); CMA = China Meteorological Administration (Order No. 16 on gov.cn: every warning
    # signal with its official 防御指南, what to do at each level).
    "CN": [
        Source("earthquake", "Ministry of Emergency Management (China)",
               "https://www.mem.gov.cn/kp/zrzh/201902/t20190226_366163.shtml", "zh"),
        Source("other", "Ministry of Emergency Management (China)",
               "https://www.mem.gov.cn/kp/zrzh/202205/t20220512_413512.shtml", "zh"),
        Source("landslide", "Ministry of Emergency Management (China)",
               "https://www.mem.gov.cn/xw/ztzl/fxkhjxs/yjkp/202404/t20240419_485508.shtml", "zh"),
        Source("landslide", "China Meteorological Administration",
               "https://www.cma.gov.cn/2011xwzx/2011xqxxw/2011xqxyw/202508/t20250808_7263954.html", "zh"),
        Source("fire", "Ministry of Emergency Management (China)",
               "https://www.mem.gov.cn/xw/xwfbh/2025n03y21xwfbh/wzsl_4260/202503/t20250321_516998.shtml", "zh"),
        Source("storm", "China Meteorological Administration",
               "https://www.gov.cn/gongbao/content/2008/content_912553.htm", "zh"),
    ],
    # Checked 2026-10-18: JNTO (Japan National Tourism Organization) "Safety tips for
    # travelers", written in English for visitors, following JMA warnings.
    "JP": [
        Source("earthquake", "Japan National Tourism Organization",
               "https://www.jnto.go.jp/safety-tips/eng/emergency/earthquake/e04.html"),
        Source("earthquake", "Japan National Tourism Organization",
               "https://www.jnto.go.jp/safety-tips/eng/emergency/earthquake/e08.html"),
        Source("earthquake", "Japan National Tourism Organization",
               "https://www.jnto.go.jp/safety-tips/eng/emergency/earthquake/e10.html"),
        Source("other", "Japan National Tourism Organization",
               "https://www.jnto.go.jp/safety-tips/eng/emergency/tsunami/t02.html"),
        Source("flood", "Japan National Tourism Organization",
               "https://www.jnto.go.jp/safety-tips/eng/emergency/weather/w04.html"),
        Source("other", "Japan National Tourism Organization",
               "https://www.jnto.go.jp/safety-tips/eng/emergency/volcanic/v02.html"),
    ],
    # None checked yet: ndrrma.gov.np renders in the browser only, and drrportal.gov.np /
    # neoc.gov.np didn't answer on 2026-10-18. Run the discovery script (Tavily) first.
    "NP": [],
}

# Countries the guidance API stores bundles for (contract RegionCode). Others can be
# built with --dry-run, but not uploaded, until the API takes them.
REGIONS = ("US", "CN")

LANGUAGES = {"en": "English", "zh": "Chinese", "ja": "Japanese", "ne": "Nepali"}

MAX_CARDS_PER_SOURCE = 4
MAX_SOURCE_CHARS = 12_000

# ── Page text ────────────────────────────────────────────────────────

_SKIP = {"script", "style", "nav", "header", "footer", "noscript", "svg", "form", "button", "aside", "select"}
_BLOCK = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "div", "section", "article", "br", "tr", "td", "dd", "dt"}


class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip, self.out = 0, []

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP:
            self.skip += 1
        if tag in _BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP and self.skip:
            self.skip -= 1
        if tag in _BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def page_text(html: str) -> str:
    p = _Text()
    p.feed(html)
    lines = (" ".join(line.split()) for line in "".join(p.out).split("\n"))
    return "\n".join(line for line in lines if len(line) > 2)


def fetch(client: httpx.Client, url: str) -> str:
    resp = client.get(url)
    resp.raise_for_status()
    return page_text(resp.text)[:MAX_SOURCE_CHARS]


# ── Grounding checks ─────────────────────────────────────────────────

def _norm(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return " ".join(re.sub(r"[^\w\s'%-]", " ", s.lower()).split())


def _numbers(s: str) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?", s))


_STOP = set("""a an and are as at be been but by can do does don't for from get go has have if in into
is it its keep make may more must no not of on or our out over own so some stay such than that the
their them then there these they this those through to up use very was we what when where which
while who will with you your yourself""".split())

# Below this share of the card's content words found in its cited lines, the card is
# saying something its evidence doesn't.
MIN_SUPPORT = 0.7


def _content_words(s: str) -> set[str]:
    words = (w.strip("'-") for w in _norm(s).split())
    return {w for w in words if len(w) > 2 and w not in _STOP}


def grounding_problem(card: dict, evidence: list[str], translated: list[str] | None = None) -> str | None:
    """None if the card is backed by its cited lines, else why it isn't.

    For a page not in English, `translated` is a literal English translation of the cited
    lines (made separately from the card): the card's words are checked against it, and
    its numbers against the original lines, so a translation can't add a number."""
    if not evidence:
        return "cites no valid source lines"
    cited = " ".join(evidence)
    words = _content_words(card.get("title", "") + " " + card.get("body", ""))
    support = len(words & _content_words(" ".join(translated) if translated is not None else cited)) / max(1, len(words))
    if support < MIN_SUPPORT:
        missing = sorted(words - _content_words(cited))[:8]
        return f"only {support:.0%} of its words are in the cited lines (e.g. {missing})"
    stray = _numbers(card.get("title", "") + " " + card.get("body", "")) - _numbers(cited)
    if stray:
        return f"numbers not in the cited lines: {sorted(stray)}"
    return None


# ── Synthesis ────────────────────────────────────────────────────────

PROMPT = """You turn an official emergency-preparedness page into short guidance cards for a
disaster-warning app. People read these offline, possibly in danger, so they must be
correct, calm and brief.

Rules:
- Use ONLY what the page below says. Do not add advice, facts or numbers from elsewhere.{language_rule}
- Each card is one situation (e.g. "during a flood warning", "while the ground is shaking").
- Body: 2-5 short imperative sentences in plain language, using the page's own wording where you can.
  Keep the page's numbers exactly.
- lines: the numbers of the page lines (L12 -> 12) that state every action in the body.
  Cite all of them; a card whose body says more than its cited lines will be discarded.
- is_critical_fallback: true only for immediate life-safety actions someone needs in the moment.
- priority: 0-100, lower = more urgent (immediate danger ~10, preparation ~60).
- Write at most {max_cards} cards; fewer is fine. Skip anything about insurance, donations or the website itself.

Hazard: {hazard}
Source: {source} ({url})

Return ONLY a JSON array, no prose, of objects with keys:
slug (short-kebab-case), applies_when (<= 80 chars), title (<= 80 chars), body, priority, is_critical_fallback, lines

Page text:
<<<
{text}
>>>{closing}"""


LANGUAGE_RULE = """
- The page lines are a literal English translation of an official {language} page. Keep to
  their wording: the cards are checked against these English lines."""

# After a long page the model tends to drift into summarising it, so the output format
# is restated after the page for translated pages.
CLOSING = """

Now return ONLY the JSON array of cards. No summary, no headings, no prose.
Each object has exactly these keys: slug, applies_when, title, body (one string), priority,
is_critical_fallback, lines (the L numbers of the page lines the card is based on, e.g. [12, 13])."""

TRANSLATE = """Translate each numbered line below from {language} into English, literally and
completely. Do not explain, summarise or add anything. Keep every number as digits.

Return ONLY a JSON object mapping each line number (as a string) to its English translation.

Lines:
<<<
{lines}
>>>

Now return ONLY the JSON object, e.g. {{"12": "English translation of L12"}}. No prose."""


def parse_cards(raw: str) -> list[dict]:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.M).strip()
    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end < start:
        raise ValueError("no JSON array in model output")
    data = json.loads(raw[start:end + 1])
    if not isinstance(data, list):
        raise ValueError("model output is not a list")
    return [c for c in data if isinstance(c, dict)]


# Lines per translation call: keeps each reply well inside max_tokens.
TRANSLATE_CHUNK_LINES = 40
TRANSLATE_CHUNK_CHARS = 2_500


def _parse_translation(raw) -> dict[int, str]:
    raw = re.sub(r"^```(?:json)?|```$", "", raw if isinstance(raw, str) else str(raw), flags=re.M).strip()
    start, end = raw.find("{"), raw.rfind("}")
    data: dict = {}
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            # Long replies sometimes have a stray quote; the "12": "..." pairs are still readable.
            data = {k: json.loads(f'"{v}"') for k, v in re.findall(r'"L?(\d+)"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)}
    else:  # also accept the lines echoed back as "L12: translation"
        data = dict(re.findall(r"^\s*(L?\d+)\s*[:：]\s*(.+?)\s*$", raw, flags=re.M | re.I))
    if not data:
        raise ValueError(f"no translations in output: {raw[:120]!r}")
    out = {}
    for k, v in data.items():
        m = re.fullmatch(r"L?(\d+)", str(k).strip(), flags=re.I)
        if m and isinstance(v, str) and v.strip():
            out[int(m.group(1))] = " ".join(v.split())
    return out


def translate_page(llm, lines: list[str], language: str) -> list[str]:
    """A literal English line for each page line, in order ("" where the model gave none).

    Cards are then written from these English lines, so the usual word check compares
    like with like; numbers are still checked against the original lines."""
    english = [""] * len(lines)
    chunk: list[int] = []

    def flush():
        if not chunk:
            return
        numbered = "\n".join(f"L{i + 1}: {lines[i]}" for i in chunk)
        got = _parse_translation(llm.invoke(TRANSLATE.format(language=language, lines=numbered)).content)
        for i in chunk:
            english[i] = got.get(i + 1, "")
        chunk.clear()

    for i in range(len(lines)):
        if chunk and (len(chunk) >= TRANSLATE_CHUNK_LINES
                      or sum(len(lines[j]) for j in chunk) + len(lines[i]) > TRANSLATE_CHUNK_CHARS):
            flush()
        chunk.append(i)
    flush()
    return english


def cards_for(source: Source, text: str, llm, reviewed_at: str, country: str = "US") -> tuple[list[dict], list[str]]:
    lines = text.split("\n")
    language = LANGUAGES.get(source.lang, source.lang)
    english: list[str] | None = None
    if source.lang != "en":
        try:
            english = translate_page(llm, lines, language)
        except Exception as e:
            return [], [f"{source.url}: translation unusable ({e})"]
    shown = lines if english is None else [e or "(untranslated)" for e in english]
    numbered = "\n".join(f"L{i}: {line}" for i, line in enumerate(shown, 1))
    msg = PROMPT.format(max_cards=MAX_CARDS_PER_SOURCE, hazard=source.hazard, source=source.name,
                        url=source.url, text=numbered,
                        language_rule="" if source.lang == "en" else LANGUAGE_RULE.format(language=language),
                        closing="" if source.lang == "en" else CLOSING)
    raw = ""
    try:
        raw = llm.invoke(msg).content
        proposed = parse_cards(raw if isinstance(raw, str) else str(raw))[:MAX_CARDS_PER_SOURCE]
    except Exception as e:
        return [], [f"{source.url}: model output unusable ({e}; starts {str(raw)[:120]!r})"]

    cited = [_cited_numbers(c.get("lines"), lines) for c in proposed]

    kept, dropped = [], []
    host = re.sub(r"^www\.", "", httpx.URL(source.url).host).split(".")[0]
    # US ids stay as they were; other countries' are prefixed so bundles never collide on the phone.
    prefix = "" if country == "US" else f"{country.lower()}-"
    for c, numbers in zip(proposed, cited, strict=True):
        slug = re.sub(r"[^a-z0-9-]+", "-", str(c.get("slug", "")).lower()).strip("-")[:40] or "card"
        evidence = [lines[n - 1] for n in numbers]
        translated = None if english is None else [english[n - 1] for n in numbers]
        card = {
            "card_id": f"{prefix}{source.hazard}-{host}-{slug}"[:64],
            "hazard_type": source.hazard,
            "applies_when": str(c.get("applies_when", ""))[:120] or None,
            "title": str(c.get("title", "")).strip()[:120],
            "body": str(c.get("body", "")).strip()[:1200],
            "priority": max(0, min(100, int(c.get("priority", 50)) if str(c.get("priority", "")).isdigit() else 50)),
            "source_name": source.name,
            "source_url": source.url,
            "last_reviewed_at": reviewed_at,
            "is_critical_fallback": c.get("is_critical_fallback") is True,
            # A reviewer reads the original line next to the translation the check used.
            "evidence": evidence if translated is None
            else [f"{o}\n[EN] {t or '(no translation)'}" for o, t in zip(evidence, translated, strict=True)],
        }
        problem = (None if len(card["title"]) >= 3 and len(card["body"]) >= 20 else "title/body too short") \
            or (None if translated is None or all(translated) else "a cited line has no translation") \
            or grounding_problem(card, evidence, translated)
        if problem:
            dropped.append(f"{card['card_id']}: {problem}")
        else:
            kept.append(card)
    return kept, dropped


def _cited_numbers(v, lines: list[str]) -> list[int]:
    """The page line numbers a card cites (accepts 12, "12", "L12"); invalid or repeated lines are ignored."""
    if not isinstance(v, list):
        v = [v] if v is not None else []
    out: list[int] = []
    for item in v:
        m = re.fullmatch(r"L?(\d+)", str(item).strip(), flags=re.I)
        if m and 1 <= int(m.group(1)) <= len(lines) and lines[int(m.group(1)) - 1] not in (lines[n - 1] for n in out):
            out.append(int(m.group(1)))
    return out[:8]


def _cited(v, lines: list[str]) -> list[str]:
    """The page lines a card cites (accepts 12, "12", "L12"); invalid numbers are ignored."""
    return [lines[n - 1] for n in _cited_numbers(v, lines)]


def dedupe_ids(cards: list[dict]) -> list[dict]:
    seen: dict[str, int] = {}
    for c in cards:
        n = seen.get(c["card_id"], 0)
        seen[c["card_id"]] = n + 1
        if n:
            c["card_id"] = f"{c['card_id'][:60]}-{n + 1}"
    return cards


def tavily_texts(urls: list[str]) -> dict[str, str]:
    """Main-content text of the curated sources via Tavily Extract (navigation and
    footers stripped, so line citations point at real guidance). Only for pages on our
    SOURCES list, which excludes sites that refuse automated access: Tavily is a
    cleaner reader here, never a way around a site's choice.
    Pages Tavily can't read are fetched directly instead."""
    from moby.search.tavily import Tavily, TavilyNotConfigured

    try:
        client = Tavily()
    except TavilyNotConfigured:
        log.warning("TAVILY_API_KEY not set: fetching pages directly")
        return {}
    texts: dict[str, str] = {}
    for i in range(0, len(urls), 20):
        try:
            got = client.extract(urls[i:i + 20], fmt="text")
        except httpx.HTTPError as e:
            log.warning("Tavily extract failed (%s): fetching directly", e)
            continue
        texts.update({u: "\n".join(" ".join(line.split()) for line in t.splitlines() if len(line.strip()) > 2)
                      [:MAX_SOURCE_CHARS] for u, t in got.items()})
    log.info("Tavily extracted %d of %d pages", len(texts), len(urls))
    return texts


def job_model(country: str):
    """Ultra for the job. Outside the US, reasoning is off (as for translation in
    moby/ai/localize.py): on Chinese pages it reasoned in the reply itself, looped and ran
    out of tokens before any JSON (seen 2026-10-18). The US runs keep their settings."""
    if country == "US":
        return chat_model("ultra", temperature=0, max_tokens=4000)
    return chat_model("ultra", temperature=0, max_tokens=4000,
                      extra_body={"chat_template_kwargs": {"enable_thinking": False}})


def main() -> int:
    p = argparse.ArgumentParser(description="Build a draft guidance bundle from official sources.")
    p.add_argument("--country", choices=sorted(c for c, s in SOURCES.items() if s), default="US",
                   help="whose official pages to use (cards are English either way)")
    p.add_argument("--dry-run", action="store_true", help="print the cards instead of uploading them")
    p.add_argument("--hazard", choices=HAZARDS, action="append", help="only these hazards (repeatable)")
    p.add_argument("--fetcher", choices=["direct", "tavily"], default="direct",
                   help="tavily: clean page text via Tavily Extract (needs TAVILY_API_KEY); falls back to direct")
    args = p.parse_args()
    if args.country not in REGIONS and not args.dry_run:
        p.error(f"the guidance API doesn't take {args.country} bundles yet (only {', '.join(REGIONS)}): use --dry-run")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    llm = job_model(args.country)
    reviewed_at = datetime.now(timezone.utc).isoformat()
    sources = [s for s in SOURCES[args.country] if not args.hazard or s.hazard in args.hazard]

    extracted = tavily_texts([s.url for s in sources]) if args.fetcher == "tavily" else {}

    cards: list[dict] = []
    with httpx.Client(follow_redirects=True, timeout=30,
                      headers={"User-Agent": "Mozilla/5.0 moby-guidance/0.1 (+https://github.com/Xlient/Moby)"}) as web:
        for src in sources:
            text = extracted.get(src.url)
            if text is None:
                try:
                    text = fetch(web, src.url)
                except httpx.HTTPError as e:
                    log.warning("skip %s: %s", src.url, e)
                    continue
            kept, dropped = cards_for(src, text, llm, reviewed_at, args.country)
            for d in dropped:
                log.warning("dropped %s", d)
            log.info("%s: %d cards kept, %d dropped", src.url, len(kept), len(dropped))
            cards.extend(kept)

    cards = dedupe_ids(cards)
    if not cards:
        log.error("no cards survived; nothing uploaded")
        return 1
    if args.dry_run:
        print(json.dumps(cards, indent=2, ensure_ascii=False))
        return 0

    api = os.environ["MOBY_API_URL"].rstrip("/")
    resp = httpx.post(f"{api}/internal/v1/guidance/bundles", timeout=60,
                      headers={"Authorization": f"Bearer {os.environ['MOBY_SERVICE_TOKEN']}"},
                      json={"region": args.country, "model": model_name("ultra"), "cards": cards})
    resp.raise_for_status()
    out = resp.json()
    log.info("%s draft bundle %s with %d cards — review and publish it", args.country, out["bundle_id"], out["card_count"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
