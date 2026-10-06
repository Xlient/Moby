"""Serverless Job: build a draft bundle of offline guidance cards (plan v3 §8.1).

For each official page in SOURCES, Nemotron Ultra turns the page's own text into a
few short cards. The page is given to the model as numbered lines, and each card must cite the
lines it is based on. A card is kept only if it survives grounding checks:

  - it cites real lines (its evidence is those lines, so quotes are verbatim by construction),
  - most of its content words appear in the cited lines (no invented advice),
  - every number in it (distances, depths, minutes...) appears in the cited lines,
  - it has the fields and lengths the contract requires.

Anything that fails is dropped and logged, never "fixed". The surviving cards are
posted as a *draft* bundle; a reviewer reads them (with their evidence) and
publishes. Plain Python by design — not a LangGraph node.

    MOBY_API_URL=... MOBY_SERVICE_TOKEN=... N_FACTORY_ACC_KEY=... python -m moby.jobs.guidance [--dry-run]
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


# Official pages only. Each card cites exactly one of these. (The Red Cross pages refuse
# automated fetches with 403, so they aren't listed; we don't work around that.)
SOURCES = [
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
]

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


def grounding_problem(card: dict, evidence: list[str]) -> str | None:
    """None if the card is backed by its cited lines, else why it isn't."""
    if not evidence:
        return "cites no valid source lines"
    cited = " ".join(evidence)
    words = _content_words(card.get("title", "") + " " + card.get("body", ""))
    support = len(words & _content_words(cited)) / max(1, len(words))
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
- Use ONLY what the page below says. Do not add advice, facts or numbers from elsewhere.
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
>>>"""


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


def cards_for(source: Source, text: str, llm, reviewed_at: str) -> tuple[list[dict], list[str]]:
    lines = text.split("\n")
    numbered = "\n".join(f"L{i}: {line}" for i, line in enumerate(lines, 1))
    msg = PROMPT.format(max_cards=MAX_CARDS_PER_SOURCE, hazard=source.hazard, source=source.name,
                        url=source.url, text=numbered)
    try:
        raw = llm.invoke(msg).content
        proposed = parse_cards(raw if isinstance(raw, str) else str(raw))
    except Exception as e:
        return [], [f"{source.url}: model output unusable ({e})"]

    kept, dropped = [], []
    host = re.sub(r"^www\.", "", httpx.URL(source.url).host).split(".")[0]
    for c in proposed[:MAX_CARDS_PER_SOURCE]:
        slug = re.sub(r"[^a-z0-9-]+", "-", str(c.get("slug", "")).lower()).strip("-")[:40] or "card"
        card = {
            "card_id": f"{source.hazard}-{host}-{slug}"[:64],
            "hazard_type": source.hazard,
            "applies_when": str(c.get("applies_when", ""))[:120] or None,
            "title": str(c.get("title", "")).strip()[:120],
            "body": str(c.get("body", "")).strip()[:1200],
            "priority": max(0, min(100, int(c.get("priority", 50)) if str(c.get("priority", "")).isdigit() else 50)),
            "source_name": source.name,
            "source_url": source.url,
            "last_reviewed_at": reviewed_at,
            "is_critical_fallback": c.get("is_critical_fallback") is True,
            "evidence": _cited(c.get("lines"), lines),
        }
        problem = (None if len(card["title"]) >= 3 and len(card["body"]) >= 20 else "title/body too short") \
            or grounding_problem(card, card["evidence"])
        if problem:
            dropped.append(f"{card['card_id']}: {problem}")
        else:
            kept.append(card)
    return kept, dropped


def _cited(v, lines: list[str]) -> list[str]:
    """The page lines a card cites (accepts 12, "12", "L12"); invalid numbers are ignored."""
    if not isinstance(v, list):
        v = [v] if v is not None else []
    out = []
    for item in v:
        m = re.fullmatch(r"L?(\d+)", str(item).strip(), flags=re.I)
        if m and 1 <= int(m.group(1)) <= len(lines) and lines[int(m.group(1)) - 1] not in out:
            out.append(lines[int(m.group(1)) - 1])
    return out[:8]


def dedupe_ids(cards: list[dict]) -> list[dict]:
    seen: dict[str, int] = {}
    for c in cards:
        n = seen.get(c["card_id"], 0)
        seen[c["card_id"]] = n + 1
        if n:
            c["card_id"] = f"{c['card_id'][:60]}-{n + 1}"
    return cards


def main() -> int:
    p = argparse.ArgumentParser(description="Build a draft guidance bundle from official sources.")
    p.add_argument("--dry-run", action="store_true", help="print the cards instead of uploading them")
    p.add_argument("--hazard", choices=HAZARDS, action="append", help="only these hazards (repeatable)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    llm = chat_model("ultra", temperature=0, max_tokens=4000)
    reviewed_at = datetime.now(timezone.utc).isoformat()
    sources = [s for s in SOURCES if not args.hazard or s.hazard in args.hazard]

    cards: list[dict] = []
    with httpx.Client(follow_redirects=True, timeout=30,
                      headers={"User-Agent": "Mozilla/5.0 moby-guidance/0.1 (+https://github.com/Xlient/Moby)"}) as web:
        for src in sources:
            try:
                text = fetch(web, src.url)
            except httpx.HTTPError as e:
                log.warning("skip %s: %s", src.url, e)
                continue
            kept, dropped = cards_for(src, text, llm, reviewed_at)
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
                      json={"region": "US", "model": model_name("ultra"), "cards": cards})
    resp.raise_for_status()
    out = resp.json()
    log.info("draft bundle %s with %d cards — review and publish it", out["bundle_id"], out["card_count"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
