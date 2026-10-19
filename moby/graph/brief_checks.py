"""Deterministic checks on a brief draft before it's saved (Step 5). Pure functions: draft and
evidence in, problems out, so they're testable without a model or a database.

Each problem is one plain sentence, because on a retry Ultra reads them ("Your previous draft
had these problems: …"). These checks catch STRUCTURE: made-up ids, a community report passed
off as official, numbers that aren't in the sources. They can't catch MEANING (issue #54's false
contradiction, or "no warning was shown" read into a general page): those need evals.
"""
from typing import Any

from moby.ai.grounding import stray_numbers

from .state import EvidenceItem

# Which evidence a claim's basis may rest on: (id prefix, kind).
_ALLOWED = {
    "official": {("O", "official"), ("W", "official")},
    "community": {("C", "community")},
    "news": {("W", "news")},
}


def _official_ids(evidence: list[EvidenceItem]) -> set[str]:
    return {e["id"] for e in evidence if e["kind"] == "official"}


def claim_problems(claim: dict[str, Any], evidence: list[EvidenceItem]) -> list[str]:
    """What's wrong with one claim (empty = fine)."""
    by_id = {e["id"]: e for e in evidence}
    text, basis, cited = claim["text"], claim["basis"], claim.get("evidence") or []
    unknown = [i for i in cited if i not in by_id]
    if unknown:
        return [f'"{text}" cites {", ".join(unknown)}, which isn\'t in the evidence.']
    out = []
    allowed = _ALLOWED.get(basis, set())
    if not any((i[0], by_id[i]["kind"]) in allowed for i in cited):
        kinds = ", ".join(f"{i} ({by_id[i]['kind']})" for i in cited)
        out.append(f'"{text}" is marked {basis} but cites {kinds}.')
    stray = stray_numbers(text, "\n".join(f"{by_id[i]['title']}\n{by_id[i]['text']}" for i in cited))
    if stray:
        out.append(f'"{text}" has numbers that aren\'t in {", ".join(cited)}: {", ".join(stray)}. '
                   "Repeat numbers exactly as the evidence writes them; don't calculate new ones.")
    return out


def _all_text(evidence: list[EvidenceItem]) -> str:
    return "\n".join(f"{e['title']}\n{e['text']}" for e in evidence)


def summary_problems(draft: dict[str, Any], evidence: list[EvidenceItem]) -> list[str]:
    stray = stray_numbers(draft.get("summary", ""), _all_text(evidence))
    if stray:
        return [f"The summary has numbers that aren't in the evidence: {', '.join(stray)}."]
    return []


def draft_problems(draft: dict[str, Any], evidence: list[EvidenceItem]) -> list[str]:
    """Everything wrong with a draft: the summary, each claim, and the agency-guidance rule."""
    out = summary_problems(draft, evidence)
    out += [p for c in draft.get("claims", []) for p in claim_problems(c, evidence)]
    if draft.get("official_guidance") and not _official_ids(evidence):
        out.append("official_guidance is set, but there is no official evidence (no O item or official W item).")
    return out


def repair(draft: dict[str, Any], evidence: list[EvidenceItem]) -> dict[str, Any] | None:
    """Last resort after the retry: keep only the claims that pass, rebuild a summary that fails,
    drop agency guidance with no official evidence. None if no claim passes (nothing is saved)."""
    claims = [c for c in draft.get("claims", []) if not claim_problems(c, evidence)]
    if not claims:
        return None
    fixed = {**draft, "claims": claims}
    if summary_problems(draft, evidence):
        # A summary can't be dropped like a claim: rebuild it from the claims that passed.
        fixed["summary"] = " ".join(c["text"] for c in claims[:2])
    if fixed.get("official_guidance") and not _official_ids(evidence):
        fixed["official_guidance"] = None
    return fixed
