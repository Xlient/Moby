from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from .state import BriefState
from .brief_nodes import gather_evidence

def build_brief_graph(checkpointer) -> CompiledStateGraph:
    """Build the graph of nodes for processing events into situation briefs."""
    graph = StateGraph(BriefState)
    graph.add_node("gather_evidence", gather_evidence)

    # Logic
    graph.add_edge(START, "gather_evidence")
    graph.add_edge("gather_evidence", END)
    return graph.compile(checkpointer=checkpointer)
