"""Sprint 0 deliverable: a one-node LangGraph graph that calls Nemotron Nano,
traced in LangSmith.

    uv run python -m moby.graph.hello "Flood water over the trail near the bridge"

Tracing is on when LANGSMITH_TRACING=true and LANGSMITH_API_KEY are set (.env);
LangChain/LangGraph send runs to the LANGSMITH_PROJECT project automatically.
Without them the graph still runs, untraced.
"""
import os
import sys
import time
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from moby.config import get_settings
from moby.llm import chat_model


class HelloState(TypedDict, total=False):
    report_text: str
    summary: str
    model: str
    latency_s: float


SYSTEM = (
    "You turn a hiker's hazard report into one short, plain sentence for a field log. "
    "Do not add facts that are not in the report."
)


def summarize_report(state: HelloState) -> HelloState:
    llm = chat_model("nano", temperature=0, max_tokens=512)
    t0 = time.perf_counter()
    msg = llm.invoke([("system", SYSTEM), ("user", state["report_text"])])
    return {
        "summary": (msg.content or "").strip(),
        "model": (msg.response_metadata or {}).get("model_name", get_settings().model_nano),
        "latency_s": round(time.perf_counter() - t0, 2),
    }


def build_graph():
    g = StateGraph(HelloState)
    g.add_node("summarize_report", summarize_report)
    g.add_edge(START, "summarize_report")
    g.add_edge("summarize_report", END)
    return g.compile()


def main() -> int:
    get_settings()  # fail fast on missing config
    traced = os.environ.get("LANGSMITH_TRACING", "").lower() == "true" and bool(os.environ.get("LANGSMITH_API_KEY"))
    text = " ".join(sys.argv[1:]) or "Water is over the trail by the footbridge and still rising, about knee deep."
    out = build_graph().invoke(
        {"report_text": text},
        config={"run_name": "hello_nano", "tags": ["sprint0", "hello-world"]},
    )
    print(f"model:   {out['model']}  ({out['latency_s']} s)")
    print(f"summary: {out['summary']}")
    if traced:
        print(f"traced:  LangSmith project {os.environ.get('LANGSMITH_PROJECT', 'default')!r} (run 'hello_nano')")
    else:
        print("traced:  no — set LANGSMITH_TRACING=true and LANGSMITH_API_KEY in .env to trace")
    return 0


if __name__ == "__main__":
    sys.exit(main())
