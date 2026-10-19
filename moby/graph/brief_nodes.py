import asyncio
import logging

from moby.ai.budget import take_sync
from moby.api.alerts import SOURCE_ATTRIBUTION
from moby.llm import model_name

from .brief_queries import community_evidence, event_facts, previous_version
from .brief_queries import save_brief as save_brief_row
from .brief_research import plan_calls, search_web
from .brief_writer import write_draft
from .db import connection
from .state import BriefState, EvidenceItem

log = logging.getLogger("moby.graph.brief_nodes")

MAX_OFFICIAL_CHARS = 1200   # long agency texts are cut; the model doesn't need the boilerplate


def official_item(facts: dict) -> EvidenceItem:
    """O1: the agency's own warning."""
    agency = SOURCE_ATTRIBUTION.get(facts["source_feed"], facts["source_feed"])
    parts = [facts["title"], facts.get("description") or ""]
    if facts.get("expires_at"):
        parts.append(f"In force until {facts['expires_at']}.")
    if facts.get("area_km2"):
        parts.append(f"Warning area about {facts['area_km2']} km².")
    text = " ".join(p for p in parts if p)[:MAX_OFFICIAL_CHARS]
    return EvidenceItem(id="O1", kind="official", title=f"{facts['title']} · {agency}", text=text)


def community_item(n: int, group: dict) -> EvidenceItem:
    """C<n>: one group of reports that saw the same thing."""
    effect = group["effect"].replace("_", " ")
    people = f"{group['reporters']} {'person' if group['reporters'] == 1 else 'people'}"
    text = (f"{people} ({group['reports']} reports) saw {effect}, "
            f"between {group['first_seen']} and {group['last_seen']}. "
            f"Severity reported: {', '.join(group['severities'])}.")
    if group["details"]:
        text += f" Details they gave: {group['details']}."
    return EvidenceItem(id=f"C{n}", kind="community", title=f"{effect.capitalize()} · {people}", text=text)


def gather_evidence(state: BriefState) -> dict:
    """Return the evidence for the brief: the official warning (O1, official events only)
    and one item per group of community reports (C1, C2…), plus the raw facts and the
    previous version for later steps."""
    with connection() as conn:
        facts = event_facts(conn, state["event_id"])
        previous = previous_version(conn, state["event_id"])
        community = community_evidence(conn, state["event_id"])

    if facts is None:                      # the event was deleted: nothing to brief
        log.info("event %s is gone; no brief", state["event_id"])
        return {"evidence": []}

    evidence: list[EvidenceItem] = []
    if facts["source"] == "official":
        evidence.append(official_item(facts))
    for n, group in enumerate(community, start=1):     # C1, C2… biggest group first
        evidence.append(community_item(n, group))

    return {"facts": facts, "community": community, "previous": previous, "evidence": evidence}


def _take_tavily_budget(units: int) -> int:
    with connection() as conn:
        return take_sync(conn, "tavily", units)


async def research(state: BriefState) -> dict:
    """Add web pages to the evidence as W1, W2… (after the O and C items): the country's official
    sites and recent news, via Tavily. Only when the event has a place name to search for (official
    warnings; community events have none). The web is optional context, so any problem (no key,
    no budget, no place, a failed search) means no W items, never a failed brief."""
    facts = state["facts"]
    if not facts.get("country") or not facts.get("place"):
        # "flood US" finds general pages about floods anywhere, not this event (seen on the first
        # real run). Without the official area's name there's nothing specific to search for.
        return {"web": []}
    granted = await asyncio.to_thread(_take_tavily_budget, 2)
    calls = plan_calls(facts, granted)
    if not calls:
        log.info("brief %s: no Tavily budget left today; no web sources", state["event_id"])
        return {"web": []}
    try:
        found = await search_web(facts, calls=calls)
    except Exception as e:  # noqa: BLE001 - web context is optional: brief from O and C items
        log.warning("brief %s: web research failed (%s); no web sources", state["event_id"], type(e).__name__)
        return {"web": []}
    web = [EvidenceItem(id=f"W{n}", **item) for n, item in enumerate(found, start=1)]
    return {"web": web, "evidence": state["evidence"] + web}


def _take_brief_budget() -> bool:
    with connection() as conn:
        return take_sync(conn, "brief", 1) == 1


async def write_brief(state: BriefState) -> dict:
    """Ask Ultra for a brief written only from the evidence. Over today's cap: no draft (the
    graph ends and the event is settled as failed; a later view with new reports asks again).
    Model errors are NOT caught: the worker records them and retries the run once."""
    if not await asyncio.to_thread(_take_brief_budget):
        log.warning("brief %s: daily brief cap reached, not written", state["event_id"])
        return {"draft": {}, "problems": ["daily brief cap reached"]}
    # No DB connection is held while Ultra writes (up to a minute): the pool is small.
    draft = await write_draft(state["evidence"], hazard=state["facts"]["hazard_type"],
                              official=state["facts"]["source"] == "official", searched_web=bool(state.get("web")))
    return {"draft": draft.to_saved(), "attempts": state.get("attempts", 0) + 1}


def save_brief(state: BriefState) -> dict:
    """Save the draft for the claimed request and mark the event 'ready', in one transaction.
    Safe to repeat on a resumed run: the second time nothing is written."""
    citations = [{"id": e["id"], "title": e["title"], "kind": e["kind"],
                  **({"url": e["url"]} if e.get("url") else {})} for e in state["evidence"]]
    with connection() as conn:
        version = save_brief_row(conn, state["event_id"], state["requested_at"], brief=state["draft"],
                                 citations=citations, facts=state["facts"], model=model_name("ultra"))
    if version is None:
        log.info("brief %s: request no longer pending; nothing saved", state["event_id"])
    return {}

