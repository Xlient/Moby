from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph

from .brief_nodes import (check_brief, explain_changes, gather_evidence, repair_brief, research, save_brief,
                          write_brief)
from .brief_policy import route_after_check, route_after_draft, route_after_evidence, route_after_repair
from .state import BriefState


def build_brief_graph(checkpointer) -> CompiledStateGraph:
    """Build the graph of nodes for processing events into situation briefs."""
    graph = StateGraph(BriefState)
    graph.add_node("gather_evidence", gather_evidence)
    graph.add_node("research", research)
    graph.add_node("write_brief", write_brief)
    graph.add_node("check_brief", check_brief)
    graph.add_node("repair_brief", repair_brief)
    graph.add_node("explain_changes", explain_changes)
    graph.add_node("save_brief", save_brief)

    # Logic
    graph.add_edge(START, "gather_evidence")
    graph.add_conditional_edges("gather_evidence", route_after_evidence, ["research", END])
    graph.add_edge("research", "write_brief")
    graph.add_conditional_edges("write_brief", route_after_draft, ["check_brief", END])
    # The cycle: a draft with problems goes back to write_brief once (route_after_check).
    graph.add_conditional_edges("check_brief", route_after_check, ["explain_changes", "write_brief", "repair_brief"])
    graph.add_conditional_edges("repair_brief", route_after_repair, ["explain_changes", END])
    graph.add_edge("explain_changes", "save_brief")
    graph.add_edge("save_brief", END)
    return graph.compile(checkpointer=checkpointer)
