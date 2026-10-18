from typing import List, Any

from langgraph.graph import END
from moby.alerts.preferences import SEVERITY_ORDER
CORROBORATION_MIN = 2            # DECISION: distinct people needed for tier 1
HIGH_CORROBORATION_PROMOTES = False  # decided: only an official match makes tier 2

def count_distinct_reporters(reports: dict[Any, Any]) -> int:
    """Count distinct reporters, ignoring relays."""
    return len({r["reporter_hash"] for r in reports})

def assign_tier(distinct_reporters: int, official_match: bool) -> int:
    """Assign a tier to an event based on the number of distinct reporters and whether an official source has confirmed it."""
    if official_match:
        return 2
    if distinct_reporters >= CORROBORATION_MIN:
        return 2 if HIGH_CORROBORATION_PROMOTES else 1
    return 0

def is_conflicting(severities: List[str]) -> bool:
    """Determine if the severities are conflicting based on a predefined scale."""
    
    indices = [SEVERITY_ORDER.index(s) for s in severities]
    return max(indices) - min(indices) >= 2

def event_severity(severities: List[str]) -> str:
    """Return the highest severity from a list of severities."""
    return max(severities, key=lambda s: SEVERITY_ORDER.index(s))

def review_reason(tier: int, severity: str, conflicting: bool) -> str | None:
    """Should this event be flagged for OPTIONAL review by a local partner, and why?

    Nothing waits for this: the event is delivered either way. It only puts the event on
    the console's list. The returned strings must be values review_queue accepts
    (migration 0006); None means "nothing to flag".
    """
    if tier >= 2:
        return None                    # matches an official warning: nothing to check
    if conflicting:
        return "conflicting_reports"   # people disagree: the most useful thing for a human to look at
    if severity == "critical":
        return "severity_floor"        # one critical report is worth a look, even alone
    if tier == 1:
        return "tier1_corroborated"    # several people agree
    return None                        # one low/medium/high report: just shown, not flagged


def route_by_tier(state: dict) -> str:
    """ Return the route for a report based on its tier. """
    is_offical = state["official_match"]

    if is_offical:
        return END
    else:
        return "draft_alert"
