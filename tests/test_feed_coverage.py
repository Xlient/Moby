"""scripts/check_feed_coverage.py: telling a quiet feed from a broken one (no network)."""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

from moby.feeds.cap import CapSource, normalize_cap

from .test_cap import cap_doc

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_feed_coverage", ROOT / "scripts" / "check_feed_coverage.py")
cov = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cov)

NOW = datetime.now(timezone.utc)


def item(minutes_ago: float = 60, lat: float | None = 14.0, lon: float | None = 121.0) -> "cov.Item":
    return cov.Item(f"x{minutes_ago}", NOW - timedelta(minutes=minutes_ago), lat, lon)


def row(current=(), entries=None, **kw) -> "cov.Row":
    feed = cov.FeedResult(entries=len(current) if entries is None else entries, current=list(current))
    return cov.Row("xx-test-en", "PH", feed, **kw)


def test_feed_error_is_broken():
    r = row()
    r.feed.error = "ConnectTimeout"
    assert cov.classify(r) == ("BROKEN", "feed: ConnectTimeout")


def test_nothing_current_is_quiet():
    assert cov.classify(row(entries=12))[0] == "quiet"
    assert cov.classify(row(entries=0)) == ("quiet", "feed answered, empty")


def test_api_alerts_without_current_items_look_stale():
    assert cov.classify(row(entries=5, api_alerts=3))[0] == "stale?"


def test_current_items_that_never_reach_the_api_are_broken():
    assert cov.classify(row([item(60, None, None)]))[0] == "BROKEN"       # e.g. unresolved area codes
    # Too new to have been polled yet: not a failure.
    assert cov.classify(row([item(2)]))[0] == "quiet"


def test_some_sampled_items_missing_is_partial():
    assert cov.classify(row([item()], api_alerts=4, probed=4, found=3))[0] == "partial"
    assert cov.classify(row([item()], api_alerts=4, probed=4, found=4)) == ("ok", "")


def test_probes_skip_unlocated_and_unpolled_items_and_spread_over_the_feed():
    items = [item(m) for m in range(20, 220, 10)] + [item(5), item(90, None, None)]
    picked = cov._probe_items(items, NOW, 4)
    assert len(picked) == 4 and all(i.lat is not None and i.issued <= NOW - cov.GRACE for i in picked)
    assert picked[0].issued > picked[-1].issued                       # newest first, oldest included
    assert picked[-1].issued <= NOW - timedelta(minutes=150)


def test_probe_point_lies_on_the_area():
    # A crescent: the vertex mean is outside the polygon, a vertex never is.
    crescent = "<polygon>0,0 0,4 4,4 4,3 1,3 1,1 4,1 4,0 0,0</polygon>"
    ev, _ = normalize_cap(cap_doc(area=crescent), CapSource("xx-test-en", "PH", "Test", "https://x"))
    assert cov._on_area(ev) == (0.0, 0.0)


def test_api_base_drops_the_version_path(monkeypatch):
    monkeypatch.delenv("MOBY_API_URL", raising=False)
    assert cov.api_base("https://api.example.org/v1/") == "https://api.example.org"
    monkeypatch.setenv("MOBY_API_URL", "https://api.example.org")
    assert cov.api_base(None) == "https://api.example.org"
