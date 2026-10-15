"""The community alert template (moby/graph/alert_text.py): pure, no database."""
import pytest

from moby.graph import alert_text as t


@pytest.mark.parametrize("hazard, effect, expected", [
    ("flood", "rising_water", "Rising water reported"),       # what people saw leads
    ("flood", None, "Flooding reported"),
    ("flood", "other", "Flooding reported"),                  # "other" says nothing: fall back to the hazard
    ("landslide", "blocked_road", "Blocked road reported"),
    ("other", None, "A hazard reported"),
])
def test_headline(hazard, effect, expected):
    assert t.headline(hazard, effect) == expected


def test_body_says_how_serious_and_what_to_do():
    text = t.body("flood", "critical")
    assert "life-threatening" in text and "moving water" in text and "local authorities" in text


@pytest.mark.parametrize("hazard", list(t.HAZARD_NAMES))
@pytest.mark.parametrize("severity", ["low", "medium", "high", "critical"])
def test_every_combination_fits_the_database(hazard, severity):
    for effect in [None, *t.EFFECT_HEADLINES]:
        assert 0 < len(t.headline(hazard, effect)) <= 120
    assert 0 < len(t.body(hazard, severity)) <= 600


def test_never_repeats_the_trust_wording_the_push_adds():
    # The push prefixes "Unverified:" and "Reported by N people…": saying it twice reads badly.
    for severity in ["low", "critical"]:
        text = t.headline("fire", None) + " " + t.body("fire", severity)
        assert "unverified" not in text.lower() and "reported by" not in text.lower()


def test_community_event_without_drafted_text_still_gets_a_real_headline():
    # If draft_alert never ran (the known gap), the API and the push fall back to the template.
    from datetime import datetime, timezone

    from moby.api.alerts import to_alert
    row = {"event_id": "e1", "source": "manual", "source_feed": None, "hazard_type": "flood",
           "observed_effect": "rising_water", "severity": "high", "tier": 1, "title": None,
           "description": None, "first_reported_at": datetime.now(timezone.utc), "lat": 1.0, "lon": 2.0}
    assert to_alert(row)["headline"] == "Rising water reported"
