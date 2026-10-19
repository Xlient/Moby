from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph

from .brief_nodes import gather_evidence, save_brief, write_brief
from .brief_policy import route_after_draft, route_after_evidence
from .state import BriefState


def build_brief_graph(checkpointer) -> CompiledStateGraph:
    """Build the graph of nodes for processing events into situation briefs."""
    graph = StateGraph(BriefState)
    graph.add_node("gather_evidence", gather_evidence)
    graph.add_node("write_brief", write_brief)
    graph.add_node("save_brief", save_brief)

    # Logic
    graph.add_edge(START, "gather_evidence")
    graph.add_conditional_edges("gather_evidence", route_after_evidence, ["write_brief", END])
    graph.add_conditional_edges("write_brief", route_after_draft, ["save_brief", END])
    graph.add_edge("save_brief", END)
    return graph.compile(checkpointer=checkpointer)
