"""Web research for the situational brief (Tavily). No database, no graph state: the event's
facts in, web pages out, so it can be tested and evaluated on its own (the `research` node in
brief_nodes.py is the glue: budget, numbering, failure handling).

What it searches, in order of value (a smaller budget stops earlier):
  1. the country's official sites (OFFICIAL[country]), last week;
  2. news, last day, never social media (SOCIAL_DOMAINS).
The text the brief reads is Tavily's snippet for each result: the passage it picked as relevant
to the query. Full pages (extract) were tried first and dropped: their first 1,500 characters
were mostly site menus (seen on the first real run, weather.gov).

Privacy: the query is built from structured fields only (hazard, the official area's name,
country), never from a reporter's note or exact position.
"""
import asyncio
from typing import Any

from moby.search.official import OFFICIAL, SOCIAL_DOMAINS, canonical_url, site_name, web_source_kind
from moby.search.tavily import SearchResult, Tavily

MAX_WEB_ITEMS = 3          # W items per brief: enough context, short enough prompt
MAX_PAGE_CHARS = 1500      # per snippet, like Ask Moby's sources
RESULTS_PER_SEARCH = 5
TIMEOUT_S = 15


def build_query(facts: dict[str, Any]) -> str:
    """e.g. "Flash Flood Warning Sonoma US" or "flood PH". The agency's product name is the best
    search term when there is one; otherwise the hazard type."""
    what = facts.get("product") or facts["hazard_type"].replace("_", " ")
    return " ".join(p for p in (what, facts.get("place"), facts.get("country")) if p)


def plan_calls(facts: dict[str, Any], granted: int) -> list[str]:
    """Which Tavily searches `granted` units buy, most valuable first: official sites (only if
    the country has a list), then news."""
    calls = (["official"] if OFFICIAL.get(facts.get("country") or "") else []) + ["news"]
    return calls[:granted]


# Words in area names that don't identify a place on their own ("City and Borough of Juneau").
_GENERIC = {"city", "county", "borough", "municipality", "parish", "district", "region", "province",
            "island", "islands", "area", "areas", "coast", "coastal", "north", "south", "east", "west",
            "northern", "southern", "eastern", "western", "central", "upper", "lower", "greater", "the",
            "and", "for", "near"}


def place_words(place: str | None) -> set[str]:
    """The words that identify a place: "Hatteras Island" → {"hatteras"}; "Lake, FL" → {"lake"}."""
    words = {w.strip(".,;()").lower() for w in (place or "").split()}
    return {w for w in words if len(w) > 2 and w not in _GENERIC}


def mentions(r: SearchResult, words: set[str]) -> bool:
    text = f"{r.title} {r.content}".lower()
    return not words or any(w in text for w in words)


def _pick(results: list[tuple[str, SearchResult]], place: str | None = None) -> list[tuple[str, SearchResult]]:
    """Drop social media, duplicate pages and pages that don't mention the place (a search for
    "Coastal Flood Warning Hatteras Island" also returns California's warnings); official pages
    first, then by Tavily's score."""
    words = place_words(place)
    seen, kept = set(), []
    for _, r in results:
        kind, key = web_source_kind(r.url), canonical_url(r.url)
        if kind is None or key in seen or not r.content or not mentions(r, words):
            continue
        seen.add(key)
        kept.append((kind, r))
    kept.sort(key=lambda kr: (kr[0] != "official", -kr[1].score))
    return kept[:MAX_WEB_ITEMS]


async def search_web(facts: dict[str, Any], *, calls: list[str]) -> list[dict[str, Any]]:
    """Run the planned calls and return web sources (without ids):
    [{kind: 'official' | 'news', title, text, url}]. Raises on Tavily errors."""
    tavily = Tavily(timeout=TIMEOUT_S)
    query = build_query(facts)
    searches = []
    if "official" in calls:
        searches.append(asyncio.to_thread(tavily.search, query, include_domains=OFFICIAL[facts["country"]],
                                          time_range="week", max_results=RESULTS_PER_SEARCH))
    if "news" in calls:
        searches.append(asyncio.to_thread(tavily.search, query, topic="news", time_range="day",
                                          exclude_domains=SOCIAL_DOMAINS, max_results=RESULTS_PER_SEARCH))
    results = [("", r) for batch in await asyncio.gather(*searches) for r in batch]   # both searches at once
    return [{
        "kind": kind,
        "title": f"{(r.title or site_name(r.url)).strip()[:90]} · {site_name(r.url)}",
        "text": r.content.strip()[:MAX_PAGE_CHARS],
        "url": r.url,
    } for kind, r in _pick(results, facts.get("place"))]
