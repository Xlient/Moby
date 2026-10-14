"""Tavily client (moby/search/tavily.py) and the guidance job's Tavily fetcher, with a mocked API."""
import json

import httpx
import pytest

from moby.jobs import guidance
from moby.search import tavily as tavily_mod
from moby.search.tavily import Tavily, TavilyNotConfigured


def transport(seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.path, request.headers.get("authorization"), json.loads(request.content)))
        if request.url.path == "/search":
            return httpx.Response(200, json={"results": [
                {"title": "Earthquake safety", "url": "https://www.bousai.go.jp/eq", "content": "Drop, cover...",
                 "score": 0.91}]})
        if request.url.path == "/extract":
            return httpx.Response(200, json={"results": [{"url": u, "raw_content": f"Page text for {u}\n\nLine two"}
                                                         for u in json.loads(request.content)["urls"]
                                                         if "blocked" not in u],
                                             "failed_results": []})
        return httpx.Response(404)
    return httpx.MockTransport(handler)


def test_search_and_extract():
    seen: list = []
    t = Tavily("tvly-test", transport=transport(seen))
    (r,) = t.search("earthquake safety", include_domains=["bousai.go.jp"], time_range="week")
    assert r.url == "https://www.bousai.go.jp/eq" and r.score == 0.91
    path, auth, body = seen[0]
    assert path == "/search" and auth == "Bearer tvly-test"
    assert body["include_domains"] == ["bousai.go.jp"] and body["time_range"] == "week"
    texts = t.extract(["https://a.gov/x", "https://blocked.gov/y"])
    assert set(texts) == {"https://a.gov/x"}                      # failures are simply absent


def test_missing_key(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    from moby.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(TavilyNotConfigured):
        Tavily()
    assert guidance.tavily_texts(["https://a.gov/x"]) == {}        # job falls back to direct fetch
    get_settings.cache_clear()


def test_guidance_fetcher_uses_tavily_text(monkeypatch):
    seen: list = []
    monkeypatch.setattr(tavily_mod, "Tavily", lambda *a, **k: Tavily("tvly-test", transport=transport(seen)))
    texts = guidance.tavily_texts(["https://www.ready.gov/floods", "https://blocked.gov/y"])
    assert texts == {"https://www.ready.gov/floods": "Page text for https://www.ready.gov/floods\nLine two"}
