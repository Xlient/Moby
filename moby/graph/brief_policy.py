"""Routing for the brief graph: plain functions of the state, testable without a database
(like policy.route_by_tier for the report graph)."""
from langgraph.graph import END


def route_after_evidence(state: dict) -> str:
    """Nothing to cite (the event was deleted): stop before paying for a model call."""
    return "research" if state.get("evidence") else END


MAX_DRAFTS = 2   # the first draft plus one retry; each is a paid Ultra call


def route_after_draft(state: dict) -> str:
    """No draft (today's cap was reached): nothing to check or save."""
    return "check_brief" if state.get("draft") else END


def route_after_check(state: dict) -> str:
    """Clean → on to "what changed" and saving. Problems → one retry with the problems spelled out; still wrong after that →
    keep what passes (repair). `attempts` is what ends the loop."""
    if not state.get("problems"):
        return "explain_changes"
    return "write_brief" if state.get("attempts", 0) < MAX_DRAFTS else "repair_brief"


def route_after_repair(state: dict) -> str:
    """Nothing passed the checks: nothing to save."""
    return "explain_changes" if state.get("draft") else END
