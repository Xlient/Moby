"""Daily caps on paid calls: past the cap, features degrade instead of spending."""
import asyncio

import psycopg
import pytest

from moby.ai import budget

from .test_chains_and_preferences import _test_db_url


@pytest.fixture
def db_url():
    url = _test_db_url()
    if url is None:
        pytest.skip("Postgres not reachable (docker compose up -d)")
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("TRUNCATE ai_usage")
    return url


def run(url, fn):
    async def go():
        async with await psycopg.AsyncConnection.connect(url, autocommit=True) as conn:
            return await fn(conn)
    return asyncio.run(go())


def test_take_grants_up_to_the_cap_then_nothing(db_url, monkeypatch):
    monkeypatch.setenv("MOBY_DAILY_CAP_EXPLAIN", "5")
    assert run(db_url, lambda c: budget.take(c, "explain", 3)) == 3
    assert run(db_url, lambda c: budget.take(c, "explain", 3)) == 2     # partial batch
    assert run(db_url, lambda c: budget.take(c, "explain")) == 0
    assert run(db_url, lambda c: budget.take(c, "ask")) == 1            # caps are per feature
    assert run(db_url, budget.usage_today)["explain"] == "5/5"


def test_concurrent_claims_never_exceed_the_cap(db_url, monkeypatch):
    monkeypatch.setenv("MOBY_DAILY_CAP_ASK", "10")

    async def many():
        async def one():
            async with await psycopg.AsyncConnection.connect(db_url, autocommit=True) as conn:
                return await budget.take(conn, "ask")
        return sum(await asyncio.gather(*(one() for _ in range(25))))
    assert asyncio.run(many()) == 10


def test_explainer_leaves_rows_pending_when_over_budget(db_url, monkeypatch):
    from moby.ai import explain

    monkeypatch.setenv("MOBY_DAILY_CAP_EXPLAIN", "0")
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("TRUNCATE events CASCADE")
        c.execute("INSERT INTO events (source, source_feed, external_id, hazard_type, severity, tier, title, "
                  "description, location, explainer_status) VALUES ('official', 'noaa', 'b1', 'flood', 'high', 2, "
                  "'Flood Warning', 'The river is rising above flood stage near the town.', "
                  "ST_SetSRID(ST_MakePoint(-123, 38), 4326)::geography, 'pending')")

    class NeverCalled:
        async def ainvoke(self, _):
            raise AssertionError("model called over budget")

    counts = run(db_url, lambda c: explain.explain_pending(c, NeverCalled(), "m"))
    assert counts == {"done": 0, "failed": 0}
    with psycopg.connect(db_url) as c:
        assert c.execute("SELECT explainer_status FROM events WHERE external_id = 'b1'").fetchone()[0] == "pending"


def test_blank_keys_from_env_example_mean_no_ai(monkeypatch):
    from moby.config import Settings

    monkeypatch.setenv("N_FACTORY_ACC_KEY", "")
    monkeypatch.setenv("TAVILY_API_KEY", "  ")
    s = Settings(_env_file=None)
    assert s.token_factory_api_key is None and s.tavily_api_key is None
