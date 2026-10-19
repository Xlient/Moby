"""brief_research: queries, call planning, picking pages, with a fake Tavily (no network)."""
import asyncio

from moby.graph import brief_research as br
from moby.search.official import SOCIAL_DOMAINS
from moby.search.tavily import SearchResult


def test_query_uses_structured_fields_only():
    assert br.build_query({"hazard_type": "flood", "product": "Flash Flood Warning", "place": "Sonoma",
                           "country": "US"}) == "Flash Flood Warning Sonoma US"
    assert br.build_query({"hazard_type": "storm_surge", "place": None, "country": "PH"}) == "storm surge PH"


def test_plan_calls():
    us = {"country": "US"}
    assert br.plan_calls(us, 2) == ["official", "news"] and br.plan_calls(us, 1) == ["official"]
    assert br.plan_calls(us, 0) == []
    assert br.plan_calls({"country": "HK"}, 2) == ["news"]                  # no official list for HK


class FakeTavily:
    instances: list = []

    def __init__(self, timeout=None):
        self.searches, self.extracted = [], []
        FakeTavily.instances.append(self)

    def search(self, query, **kw):
        self.searches.append((query, kw))
        if kw.get("topic") == "news":
            return [SearchResult("Flood closes road", "https://www.reuters.com/flood", "News text", 0.8),
                    SearchResult("Post", "https://www.facebook.com/p/1", "Social", 0.99)]
        return [SearchResult("Flood safety", "https://www.weather.gov/safety/flood", "Snippet", 0.5),
                SearchResult("Flood safety", "http://weather.gov/safety/flood/", "Same page", 0.4)]

    def extract(self, urls):
        self.extracted.append(urls)
        return {urls[0]: "Full page text " * 200}


def run(monkeypatch, calls):
    FakeTavily.instances.clear()
    monkeypatch.setattr(br, "Tavily", FakeTavily)
    facts = {"hazard_type": "flood", "product": None, "place": "Sonoma", "country": "US"}
    return asyncio.run(br.search_web(facts, calls=calls)), FakeTavily.instances[0]


def test_search_web_keeps_trust_order_and_drops_duplicates_and_social(monkeypatch):
    out, tavily = run(monkeypatch, ["official", "news"])
    assert [(o["kind"], o["url"]) for o in out] == [("official", "https://www.weather.gov/safety/flood"),
                                                    ("news", "https://www.reuters.com/flood")]
    assert out[0]["title"] == "Flood safety · weather.gov"
    assert [o["text"] for o in out] == ["Snippet", "News text"]            # Tavily's snippets, not full pages
    assert tavily.extracted == []
    official, news = tavily.searches
    assert official[1]["include_domains"] == ["ready.gov", "weather.gov", "fema.gov", "cdc.gov"]
    assert news[1]["topic"] == "news" and news[1]["exclude_domains"] == SOCIAL_DOMAINS


def test_one_unit_searches_official_sites_only(monkeypatch):
    out, tavily = run(monkeypatch, ["official"])
    assert len(tavily.searches) == 1 and [o["kind"] for o in out] == ["official"]
