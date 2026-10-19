"""The situational brief's model call (Nemotron Ultra). No database, no graph state: evidence in,
BriefDraft out, so it can be tested and evaluated on its own (the write_brief node is the glue)."""
from moby.graph.schemas import BriefDraft
from moby.graph.state import EvidenceItem
from moby.llm import chat_model

BRIEF_SYS_PROMPT = """You write short situational briefs for people near a hazard, using ONLY the numbered evidence you are given.

Evidence ids: O = an official agency's warning, C = a group of reports from people nearby (unverified),
W = a web page, marked (official) for a government website or (news) for a news outlet.

Rules:
- Every fact in your brief is a claim that cites the ids it rests on. If no evidence supports something, leave it out.
- Never add places, numbers, times, causes or hazards that aren't in the evidence. Repeat numbers exactly as written.
- Community reports (C) are unverified. Say so ("people nearby report…"). Never present them as official.
- Mark a claim 'official' only if it cites an O item or an (official) W item. A (news) W item is a news report: name the outlet ("Reuters reports…") and never present it as official or as confirmed.
- If items disagree (different severities, a report the warning doesn't mention), put it in contradictions. Don't pick a side.
- Don't tell people what to do unless an O item or an (official) W item says it; then attribute it to the agency.
- Plain language, short sentences, no alarmism and no reassurance ("it is safe") the evidence doesn't give.
- In uncertainty, say honestly what isn't known: few reporters, unverified reports, no official warning, information may be out of date.
"""

# Ultra writes a reasoning step plus up to 8 claims: a long reply. One quick retry here; the
# brief worker retries the whole run once more after that (brief_queries.MAX_ATTEMPTS).
TIMEOUT_S = 60


def format_evidence(evidence: list[EvidenceItem]) -> str:
    """The numbered evidence as the model reads it: id and kind stand out, then the text."""
    return "\n\n".join(f"[{e['id']}] ({e['kind']}) {e['title']}\n{e['text']}" for e in evidence)


def brief_message(evidence: list[EvidenceItem], *, hazard: str, official: bool) -> str:
    """The user message: a line of context, then the evidence."""
    who = "an official warning" if official else "reported by people nearby (no official warning)"
    return f"Hazard: {hazard}. Event: {who}.\n\nEvidence:\n{format_evidence(evidence)}"


async def write_draft(evidence: list[EvidenceItem], *, hazard: str, official: bool) -> BriefDraft:
    """Ask Ultra for a brief written only from `evidence`. Raises on timeouts and API errors."""
    llm = chat_model("ultra", temperature=0, timeout=TIMEOUT_S, max_retries=1).with_structured_output(
        BriefDraft, method="function_calling")
    return await llm.ainvoke([("system", BRIEF_SYS_PROMPT),
                              ("user", brief_message(evidence, hazard=hazard, official=official))])
