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
import time
from dataclasses import dataclass
from typing import Literal

import httpx

from moby.config import get_settings

API = "https://api.tavily.com"
# Tavily's error codes (docs.tavily.com/documentation/api-reference): 429 is a per-minute
# rate limit, worth one short retry; 432/433 mean the plan's or pay-as-you-go credits are
# used up, so retrying won't help until they reset.
RATE_LIMITED = 429
OUT_OF_CREDITS = (432, 433)
RETRY_AFTER_MAX_S = 2.0     # callers are people waiting for an answer: never wait long


class TavilyError(httpx.HTTPStatusError):
    """Tavily answered with an error: str() says the status and Tavily's own reason
    (e.g. 'Tavily 400: Query is missing.'), never the query."""

    @property
    def status(self) -> int:
        return self.response.status_code

    @property
    def out_of_credits(self) -> bool:
        return self.status in OUT_OF_CREDITS


def _reason(resp: httpx.Response) -> str:
    try:
        detail = resp.json().get("detail")
    except (ValueError, AttributeError):
        detail = None
    if isinstance(detail, dict):
        detail = detail.get("error")
    return str(detail or resp.reason_phrase or "error")[:160]


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
               exclude_domains: list[str] | None = None,
               topic: Literal["general", "news"] = "general", time_range: str | None = None,
               max_results: int = 5, depth: Literal["basic", "advanced"] = "basic") -> list[SearchResult]:
        body = {"query": query, "topic": topic, "max_results": max_results, "search_depth": depth}
        if include_domains:
            body["include_domains"] = include_domains
        if exclude_domains:
            body["exclude_domains"] = exclude_domains
        if time_range:
            body["time_range"] = time_range
        resp = self._post("/search", body)
        return [SearchResult(r.get("title", ""), r["url"], r.get("content", ""), float(r.get("score", 0)),
                             r.get("published_date")) for r in resp.json().get("results", [])]

    def extract(self, urls: list[str], *, fmt: Literal["text", "markdown"] = "text") -> dict[str, str]:
        """{url: page text} for the pages Tavily could read; failures are simply absent."""
        resp = self._post("/extract", {"urls": urls[:20], "format": fmt, "extract_depth": "basic"})
        return {r["url"]: r.get("raw_content") or "" for r in resp.json().get("results", []) if r.get("raw_content")}

    def _post(self, path: str, body: dict) -> httpx.Response:
        """POST, retrying once (after at most RETRY_AFTER_MAX_S) if rate limited; any error
        response raises TavilyError."""
        resp = self._http.post(path, json=body)
        if resp.status_code == RATE_LIMITED:
            try:
                wait = float(resp.headers.get("retry-after", 1))
            except ValueError:
                wait = 1.0
            time.sleep(min(max(wait, 0.0), RETRY_AFTER_MAX_S))
            resp = self._http.post(path, json=body)
        if resp.is_error:
            raise TavilyError(f"Tavily {resp.status_code}: {_reason(resp)}", request=resp.request, response=resp)
        return resp
