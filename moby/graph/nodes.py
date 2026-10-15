import psycopg
from .state import PipelineState    
from .policy import assign_tier, is_conflicting, event_severity, review_reason
from .queries import find_matching_event, create_event, attach_report, event_reporters, save_event
from moby.config import get_settings

def fuse(state: PipelineState) -> dict:
    """Return a fused state for the event, based on the original report and any existing events."""
    db_url = get_settings().database_url
    with psycopg.connect(db_url) as conn:
        match = find_matching_event(conn, state["report"])
        if match is None:
            event_id = create_event(conn, state["report"])
            
        else:
            event_id = match["event_id"]
            
        attached = attach_report(conn, state["report"]["report_id"], event_id)
        distinct_reporters, severities = event_reporters(conn, event_id)
        return {
            "attached": attached, # signal for reruns
            "event_id": event_id,
            "joined_existing": match is not None,
            "official_match": match is not None and match["official"],
            "distinct_reporters": distinct_reporters,
            "severities": severities,
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

def save(state: PipelineState) -> dict:
    """Save the event to the database, based on the fused state."""
    db_url = get_settings().database_url
    with psycopg.connect(db_url) as conn:
        saved = save_event(conn, state["event_id"], tier=state["tier"], severity=state["severity"],
                           reports_disagree=state["reports_disagree"], distinct_reporters=state["distinct_reporters"])
        return {"saved": saved}
