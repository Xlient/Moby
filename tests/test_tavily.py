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


def replies(*responses):
    """A transport answering each request with the next response; the requests are kept."""
    seen, queue = [], list(responses)

    def handler(request):
        seen.append(request)
        return queue.pop(0)
    return httpx.MockTransport(handler), seen


def test_errors_say_the_status_and_tavilys_reason():
    t, seen = replies(httpx.Response(400, json={"detail": {"error": "Query is missing."}}))
    with pytest.raises(tavily_mod.TavilyError) as e:
        Tavily("tvly-test", transport=t).search("")
    assert str(e.value) == "Tavily 400: Query is missing." and e.value.status == 400 and len(seen) == 1
    assert isinstance(e.value, httpx.HTTPStatusError)            # callers catching httpx errors still do


def test_rate_limit_is_retried_once_and_used_up_credits_are_not(monkeypatch):
    waits = []
    monkeypatch.setattr(tavily_mod.time, "sleep", waits.append)
    ok = httpx.Response(200, json={"results": [{"title": "t", "url": "https://a.gov/x", "content": "c"}]})
    t, seen = replies(httpx.Response(429, headers={"retry-after": "30"}), ok)
    assert [r.url for r in Tavily("tvly-test", transport=t).search("q")] == ["https://a.gov/x"]
    assert len(seen) == 2 and waits == [tavily_mod.RETRY_AFTER_MAX_S]   # never waits Tavily's 30 s
    t, seen = replies(httpx.Response(429), httpx.Response(429, json={"detail": {"error": "Rate limit exceeded"}}))
    with pytest.raises(tavily_mod.TavilyError, match="Tavily 429: Rate limit exceeded"):
        Tavily("tvly-test", transport=t).search("q")
    t, seen = replies(httpx.Response(432, json={"detail": {"error": "This request exceeds your plan's set usage limit."}}))
    with pytest.raises(tavily_mod.TavilyError) as e:
        Tavily("tvly-test", transport=t).extract(["https://a.gov/x"])
    assert e.value.out_of_credits and len(seen) == 1


def test_missing_key(monkeypatch):
    # Empty, not deleted: settings also read .env, where a developer's real key may be.
    monkeypatch.setenv("TAVILY_API_KEY", "")
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


# ── Web sources in a brief (moby/search/official.py) ──────────────────────────

from moby.search.official import canonical_url, web_source_kind  # noqa: E402


@pytest.mark.parametrize("url, kind", [
    ("https://www.weather.gov/safety/flood", "official"),          # OFFICIAL list
    ("https://pagasa.dost.gov.ph/bulletin", "official"),           # a subdomain of a listed one
    ("https://www.dhm.gov.np/warning", "official"),                # government-only domain, not listed
    ("https://www.jma.go.jp/bosai", "official"),
    ("https://www.reuters.com/world/flood", "news"),
    ("https://kathmandupost.com/national/flood", "news"),
    ("https://www.facebook.com/somepage/posts/1", None),           # social media: left out
    ("https://m.youtube.com/watch?v=x", None),
    ("https://notgov.com/x", "news"),                              # "gov" inside a word isn't government
])
def test_web_source_kind(url, kind):
    assert web_source_kind(url) == kind


def test_canonical_url_merges_the_same_page():
    a = canonical_url("https://www.weather.gov/safety/flood-watch-warning")
    assert a == canonical_url("http://weather.gov/safety/flood-watch-warning/") == canonical_url(
        "https://weather.gov/safety/flood-watch-warning#top")
    assert a != canonical_url("https://weather.gov/safety/other")


def test_search_sends_exclude_domains():
    seen = []
    Tavily("k", transport=transport(seen)).search("q", exclude_domains=["facebook.com"])
    assert seen[0][2]["exclude_domains"] == ["facebook.com"]
