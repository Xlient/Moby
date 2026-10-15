from .state import PipelineState    
from .policy import assign_tier, is_conflicting, event_severity, review_reason
def fuse(state: PipelineState) -> dict:
    # STUB: step 3 replaces this with real PostGIS matching.
    return {
        "event_id": "fake-event-1",
        "joined_existing": False,
        "official_match": False,
        "distinct_reporters": 1,
        "severities": [state["report"]["severity"]],
    }


def structured_report(state: PipelineState) -> dict:
    """Return a structured report for the event, based on the original report and the fused state."""
    return {"structured": {}}

def score(state: PipelineState) -> dict:
    """Return a score for the event, based on the fused state."""
    tier = assign_tier(state["distinct_reporters"], state["official_match"])
    severity = event_severity( state["severities"])
    conflicting = is_conflicting(state["severities"])
    review = review_reason(tier, severity, conflicting)
    return{
        "tier": tier,
        "severity": severity,
        "reports_disagree": conflicting,
        "review_reason": review,
    }

def draft_alert(state: PipelineState) -> dict:
    """Return a draft alert for the event, based on the fused state."""
    return {
        "alert_headline": "Fake headline",
        "alert_body": "Fake body",
    }
