"""'What changed' since the previous brief (Step 6). Code decides what changed, by diffing the
facts saved with the last brief against today's; Nemotron Super only puts that list into one or
two plain sentences. If Super is over its cap, fails, or adds a number that isn't in the diff,
the plain sentences written here are used instead. No database, no graph state.
"""
import re
from typing import Any

from moby.ai.grounding import stray_numbers
from moby.llm import chat_model

_SEVERITY = ["low", "medium", "high", "critical"]
AREA_CHANGE = 0.10        # a warning area that grows or shrinks by less than 10% isn't news


def diff_facts(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, Any]]:
    """The meaningful differences between two facts snapshots, most important first."""
    out: list[dict[str, Any]] = []
    o_sev, n_sev = old.get("severity"), new.get("severity")
    if o_sev in _SEVERITY and n_sev in _SEVERITY and o_sev != n_sev:
        up = _SEVERITY.index(n_sev) > _SEVERITY.index(o_sev)
        out.append({"type": "severity", "direction": "up" if up else "down", "from": o_sev, "to": n_sev})
    if (old.get("product") or old.get("title")) != (new.get("product") or new.get("title")) and new.get("source") == "official":
        out.append({"type": "product", "from": old.get("product") or old.get("title"),
                    "to": new.get("product") or new.get("title")})
    if old.get("expires_at") != new.get("expires_at") and new.get("expires_at"):
        later = not old.get("expires_at") or new["expires_at"] > old["expires_at"]
        out.append({"type": "expires", "direction": "extended" if later else "shortened",
                    "from": old.get("expires_at"), "to": new["expires_at"]})
    o_area, n_area = old.get("area_km2"), new.get("area_km2")
    if o_area and n_area and abs(n_area - o_area) / o_area >= AREA_CHANGE:
        out.append({"type": "area", "direction": "grew" if n_area > o_area else "shrank",
                    "from": o_area, "to": n_area})
    more = (new.get("reporters") or 0) - (old.get("reporters") or 0)
    if more > 0:
        out.append({"type": "reporters", "added": more, "total": new["reporters"]})
    if new.get("source") == "official" and old.get("description") != new.get("description"):
        out.append({"type": "wording"})
    return out


def _when(ts: str | None) -> str:
    return f"{ts[:16].replace('T', ' ')} UTC" if ts else "no set end"


def describe(changes: list[dict[str, Any]]) -> str:
    """Plain sentences for a list of changes: the fallback, and what Super is checked against."""
    s = []
    for c in changes:
        match c["type"]:
            case "severity":
                s.append(f"Severity {'raised' if c['direction'] == 'up' else 'lowered'} from {c['from']} to {c['to']}.")
            case "product":
                s.append(f"The agency changed it from {c['from']} to {c['to']}.")
            case "expires":
                s.append(f"The warning was {c['direction']}: now in force until {_when(c['to'])}.")
            case "area":
                s.append(f"The warning area {c['direction']} from {c['from']:g} to {c['to']:g} km².")
            case "reporters":
                who = "person" if c["added"] == 1 else "people"
                s.append(f"{c['added']} more {who} nearby reported it, unverified ({c['total']} in all).")
            case "wording":
                s.append("The agency updated the warning's text.")
    return " ".join(s)


CHANGES_PROMPT = """Rewrite this list of changes to a hazard alert as one or two short, plain sentences for people nearby.
Use ONLY what the list says. Keep every number exactly as written. Keep "unverified" for people's reports;
only the agency's own changes are official. No advice, no speculation.

Changes:
{changes}"""


async def write_changes(changes: list[dict[str, Any]]) -> str:
    """Super's sentence for the changes; the plain description if Super adds a number."""
    plain = describe(changes)
    # Super reasons before answering (as in moby/ai/explain.py): leave room for that.
    llm = chat_model("super", temperature=0, timeout=30, max_retries=1, max_tokens=2000)
    raw = str((await llm.ainvoke(CHANGES_PROMPT.format(changes=plain))).content)
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.S).strip().strip('"')
    return text if text and not stray_numbers(text, plain) and len(text) <= 400 else plain
