"""Routing for the brief graph: plain functions of the state, testable without a database
(like policy.route_by_tier for the report graph)."""
from langgraph.graph import END


def route_after_evidence(state: dict) -> str:
    """Nothing to cite (the event was deleted): stop before paying for a model call."""
    return "research" if state.get("evidence") else END


def route_after_draft(state: dict) -> str:
    """No draft (today's cap was reached): nothing to save."""
    return "save_brief" if state.get("draft") else END
