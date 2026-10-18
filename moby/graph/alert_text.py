"""Alert text for community events: a template, no model (step 4; Nano can replace it in step 5).

Pure functions, like policy.py: facts in, text out. The push and the app add the trust
part themselves ("Unverified: …", "Reported by 3 people nearby, not confirmed by
officials", the reports-disagree note), so the text here never repeats it.

Limits come from the events table (migration 0007): headline ≤ 120, body ≤ 600 characters.
"""
HEADLINE_MAX = 120
BODY_MAX = 600

HAZARD_NAMES = {
    "flood": "Flooding",
    "fire": "Fire or smoke",
    "earthquake": "Shaking",
    "storm": "Storm damage",
    "landslide": "Landslide",
    "other": "A hazard",
}

# What people saw is more specific than the hazard type, so it leads when present.
EFFECT_HEADLINES = {
    "rising_water": "Rising water",
    "smoke_or_fire_visible": "Smoke or flames",
    "ground_shaking": "Shaking",
    "blocked_road": "Blocked road",
    "structural_damage": "Damage to buildings",
}

SEVERITY_PHRASES = {
    "low": "minor so far",
    "medium": "worth watching",
    "high": "dangerous",
    "critical": "life-threatening",
}

ADVICE = {
    "flood": "Stay out of moving water and away from streams and low roads.",
    "fire": "Be ready to leave, and avoid the smoke.",
    "earthquake": "Expect aftershocks. Stay clear of damaged buildings.",
    "storm": "Stay clear of fallen trees and power lines.",
    "landslide": "Avoid the slope and the road below it.",
    "other": "Keep your distance.",
}


def headline(hazard_type: str, observed_effect: str | None) -> str:
    """e.g. "Rising water reported", or "Flooding reported" when no specific effect was given."""
    what = EFFECT_HEADLINES.get(observed_effect or "") or HAZARD_NAMES.get(hazard_type, "A hazard")
    return f"{what} reported"[:HEADLINE_MAX]


def body(hazard_type: str, severity: str) -> str:
    """What people say about it, plus one plain safety line for the hazard."""
    phrase = SEVERITY_PHRASES.get(severity, "worth watching")
    advice = ADVICE.get(hazard_type, ADVICE["other"])
    text = f"People nearby say it looks {phrase}. {advice} Follow instructions from local authorities."
    return text[:BODY_MAX]
