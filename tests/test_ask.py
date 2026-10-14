"""Ask Moby: answers only from cited sources; personal details never reach the web search."""
import asyncio
from contextlib import asynccontextmanager

from moby.ai import ask
from moby.ai.ask import Source

CARD = Source("guidance", "Flooded road: turn around", "National Weather Service",
              "https://www.weather.gov/safety/flood-turn-around-dont-drown",
              "Never drive through flooded roads. Just 12 inches of moving water can carry away most cars. "
              "Turn around and find another route.")
ALERT = Source("alert", "Flood warning", "NWS", None, "The river is expected to rise above flood stage.")


def test_parse_reads_citations_and_abstain():
    assert ask.parse('```json\n{"answer": "Turn around [1].", "citations": [1, "2", "x"]}\n```') == {
        "answer": "Turn around [1].", "citations": [1, 2], "abstain": False}
    assert ask.parse('{"abstain": true}')["abstain"] is True


def test_check_accepts_a_cited_grounded_answer():
    out = {"answer": "Never drive through flooded roads [1]: 12 inches of moving water can carry away most cars.",
           "citations": [], "abstain": False}
    assert ask.check(out, [CARD]) is None and out["citations"] == [1]


def test_check_rejects_uncited_invented_or_abstained_answers():
    sources = [CARD, ALERT]
    assert ask.check({"answer": "Turn around.", "citations": [], "abstain": False}, sources) == "no valid citations"
    assert ask.check({"answer": "Turn around.", "citations": [7], "abstain": False}, sources) == "no valid citations"
    invented = {"answer": "Just 6 inches of water can carry away most cars [1].", "citations": [1], "abstain": False}
    assert "numbers" in ask.check(invented, sources)
    off = {"answer": "Pack your passport, medication and pet food in a waterproof bag [2].", "citations": [2],
           "abstain": False}
    assert ask.check(off, sources) == "answer strays from its sources"
    # The number is in source 1 but only source 2 is cited: still rejected.
    wrong_cite = {"answer": "12 inches of moving water can carry away most cars [2].", "citations": [2], "abstain": False}
    assert "numbers" in ask.check(wrong_cite, sources)
    assert ask.check({"answer": "", "citations": [], "abstain": True}, sources) == "abstained"


def test_rate_limit_per_user_per_hour():
    ask._asked.clear()
    assert all(ask.allow("u1", now=float(i)) for i in range(ask.RATE_LIMIT))
    assert not ask.allow("u1", now=100.0)
    assert ask.allow("u2", now=100.0)
    assert ask.allow("u1", now=3601.0)


# ── answer(): wired with fakes, no database or model ───────────────────

class Fake:
    def __init__(self, content=None):
        self.content, self.prompts = content, []

    async def ainvoke(self, prompt):
        self.prompts.append(prompt)
        return type("R", (), {"content": self.content})()

    async def aembed_query(self, _text):
        return [0.0] * 1024


class FakePool:
    @asynccontextmanager
    async def connection(self):
        yield None


def wire(monkeypatch, *, cards, answer_json, web=()):
    nano, sup = Fake("flooded road safety advice"), Fake(answer_json)
    monkeypatch.setattr(ask, "_models", lambda: {"embed": Fake(), "nano": nano, "super": sup, "super_name": "super"})

    async def card_sources(_conn, _v):
        return cards

    async def alert_sources(_conn, _lat, _lon):
        return [ALERT]

    searched = []

    class FakeTavily:
        def __init__(self, timeout):
            pass

        def search(self, query, include_domains, max_results):
            searched.append((query, include_domains))
            return list(web)

    monkeypatch.setattr(ask, "card_sources", card_sources)
    monkeypatch.setattr(ask, "alert_sources", alert_sources)
    monkeypatch.setattr("moby.search.tavily.Tavily", FakeTavily)
    return nano, sup, searched


def test_answer_from_cards_renumbers_citations_and_skips_the_web(monkeypatch):
    _, sup, searched = wire(monkeypatch, cards=[(CARD, 0.71)],
                            answer_json='{"answer": "Turn around and find another route [2].", "citations": [2]}')
    out = asyncio.run(ask.answer(FakePool(), "Road ahead is flooded, what now?", lat=38.5, lon=-123.0, country="US"))
    assert out["abstained"] is False and out["searched_web"] is False and searched == []
    assert out["answer"] == "Turn around and find another route [1]."     # [2] in the prompt → [1] for the app
    assert out["sources"] == [{"n": 1, "kind": "guidance", "title": CARD.title, "publisher": CARD.publisher,
                               "url": CARD.url}]
    assert "[1] (official alert)" in sup.prompts[0] and "[2] (official guidance)" in sup.prompts[0]


def test_weak_cards_search_official_domains_with_a_rewritten_query(monkeypatch):
    from moby.search.tavily import SearchResult
    web = [SearchResult("Floods", "https://www.ready.gov/floods", "Turn around, don't drown. Find another route.", 0.9,
                        None)]
    nano, _, searched = wire(monkeypatch, cards=[], web=web,
                             answer_json='{"answer": "Turn around and find another route [2].", "citations": [2]}')
    question = "I'm Ana at 12 Elm St and the road is flooded, what now?"
    out = asyncio.run(ask.answer(FakePool(), question, lat=1.0, lon=2.0, country="US"))
    assert searched == [("flooded road safety advice", ["ready.gov", "weather.gov", "fema.gov", "cdc.gov"])]
    assert "Elm" not in searched[0][0] and question in nano.prompts[0]
    assert out["searched_web"] is True and out["sources"][0]["kind"] == "web"


def test_no_country_domains_and_no_sources_means_no_model_call(monkeypatch):
    _, sup, searched = wire(monkeypatch, cards=[], answer_json="{}")
    out = asyncio.run(ask.answer(FakePool(), "What is the capital of France?", country="ZZ"))
    assert out == {"answer": None, "abstained": True, "sources": [], "model": "super", "searched_web": False}
    assert sup.prompts == [] and searched == []


def test_ungrounded_answer_is_withheld(monkeypatch):
    wire(monkeypatch, cards=[(CARD, 0.7)],
         answer_json='{"answer": "It is safe to drive through 6 inches of water [1].", "citations": [1]}')
    out = asyncio.run(ask.answer(FakePool(), "Can I drive through it?"))
    assert out["abstained"] is True and out["answer"] is None
