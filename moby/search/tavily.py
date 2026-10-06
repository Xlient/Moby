"""Tavily web search and page extraction (https://docs.tavily.com).

Used where web context helps a *person* or a *grounded* document — never to decide
urgency (tier/confidence/alerts stay deterministic):
  - the guidance job: clean text from curated official pages (extract), and
    discovering candidate official pages for new countries (search; a person approves);
  - the LangGraph situational brief and adjudicator (owned by the graph): recent news
    and agency bulletins as cited context.

Privacy: build queries from structured event data (hazard, place, time), never from a
reporter's note. Tavily is listed as a processor in the privacy policy.
Cost: search 1 credit (basic) / 2 (advanced); extract 1 credit per 5 pages (basic).
"""
from dataclasses import dataclass
from typing import Literal

import httpx

from moby.config import get_settings

API = "https://api.tavily.com"


class TavilyNotConfigured(RuntimeError):
    """TAVILY_API_KEY is not set: callers should fall back (e.g. direct fetch, no web context)."""


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    content: str
    score: float
    published_date: str | None = None


class Tavily:
    def __init__(self, api_key: str | None = None, *, timeout: float = 20.0, transport: httpx.BaseTransport | None = None):
        key = api_key or (get_settings().tavily_api_key.get_secret_value() if get_settings().tavily_api_key else None)
        if not key:
            raise TavilyNotConfigured("TAVILY_API_KEY is not set")
        self._http = httpx.Client(base_url=API, timeout=timeout, transport=transport,
                                  headers={"Authorization": f"Bearer {key}"})

    def search(self, query: str, *, include_domains: list[str] | None = None,
               topic: Literal["general", "news"] = "general", time_range: str | None = None,
               max_results: int = 5, depth: Literal["basic", "advanced"] = "basic") -> list[SearchResult]:
        body = {"query": query, "topic": topic, "max_results": max_results, "search_depth": depth}
        if include_domains:
            body["include_domains"] = include_domains
        if time_range:
            body["time_range"] = time_range
        resp = self._http.post("/search", json=body)
        resp.raise_for_status()
        return [SearchResult(r.get("title", ""), r["url"], r.get("content", ""), float(r.get("score", 0)),
                             r.get("published_date")) for r in resp.json().get("results", [])]

    def extract(self, urls: list[str], *, fmt: Literal["text", "markdown"] = "text") -> dict[str, str]:
        """{url: page text} for the pages Tavily could read; failures are simply absent."""
        resp = self._http.post("/extract", json={"urls": urls[:20], "format": fmt, "extract_depth": "basic"})
        resp.raise_for_status()
        return {r["url"]: r.get("raw_content") or "" for r in resp.json().get("results", []) if r.get("raw_content")}
