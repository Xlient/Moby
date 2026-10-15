from langgraph.graph import StateGraph, START, END
from .state import PipelineState
from .nodes import fuse, structured_report, score, draft_alert
from .policy import route_by_tier

def build_graph(checkpointer):
    """Build the graph of nodes for processing reports into alerts."""
    graph = StateGraph(PipelineState)
    graph.add_node("fuse", fuse)
    graph.add_node("structured_report", structured_report)
    graph.add_node("score", score)
    graph.add_node("draft_alert", draft_alert)

# Logic
    graph.add_edge(START, "structured_report")
    graph.add_edge("structured_report", "fuse")
    graph.add_edge("fuse", "score")
    graph.add_conditional_edges("score", route_by_tier, ["draft_alert", END])
    graph.add_edge("draft_alert", END)
    return graph.compile(checkpointer=checkpointer)
