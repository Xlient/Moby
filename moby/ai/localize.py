"""Moby's own AI text, in the reader's language (Nemotron Super, reasoning off).

Explanations, Ask Moby answers and push text are written and grounding-checked in
English. This translates that already-checked text into the phone's language, with the
same guardrail the warning translator uses: every number must survive, and so must
Ask Moby's [n] citation markers. If anything fails, the reader gets the English.

Results are cached by the callers (per event and language), so each language costs
one Nano call per event, not one per reader.
"""
import json
import logging
import re
from functools import cache

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from .grounding import numbers

log = logging.getLogger("moby.ai.localize")

# Languages whose output was checked by eye on real warnings (2026-10-15), by ISO 639-1 code.
# Left out after testing: Greek (mixed in English, added "rainfall"), Nepali (came back as
# Hindi). Nano was faster but added facts in German and Hindi and garbled Filipino.
LANGUAGES = {
    "es": "Spanish", "fr": "French", "de": "German", "it": "Italian", "pt": "Portuguese",
    "nl": "Dutch", "pl": "Polish", "tr": "Turkish", "ru": "Russian",
    "ja": "Japanese", "ko": "Korean", "zh": "Chinese (Simplified)", "vi": "Vietnamese",
    "th": "Thai", "id": "Indonesian", "tl": "Filipino", "hi": "Hindi",
}
ALIASES = {"fil": "tl", "in": "id"}
MARKER = r"\[\d+\]"     # Ask Moby's citations

PROMPT = """Translate the JSON values below from English into {language} for a member of the public
reading a safety message on their phone.

Rules:
- Translate faithfully and plainly. Do not add, remove, soften or explain anything.
- Keep every number exactly as written, in Western digits (0-9). Never convert units:
  keep feet, inches, miles and degrees as they are ("12 inches" stays 12, in inches).
- Keep markers like [1] and [2] exactly where they are.
- Never translate names of places, rivers, regions or agencies. Keep them in English letters
  exactly as written; you may add the local spelling in brackets after a name. Names in this
  text: {names}

Return ONLY JSON with the same keys and the same structure.

{payload}"""


def normalize(tag: str | None) -> str | None:
    """'es-MX' → 'es'; None for English or a language we don't translate into."""
    if not tag:
        return None
    code = ALIASES.get(tag.split("-")[0].split("_")[0].lower(), tag.split("-")[0].split("_")[0].lower())
    return code if code in LANGUAGES else None


def _flatten(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [s for v in value for s in _flatten(v)]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _flatten(v)]
    return []


def _same_shape(a, b) -> bool:
    if isinstance(a, str):
        return isinstance(b, str)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(_same_shape(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(_same_shape(a[k], b[k]) for k in a)
    return a == b


# Generic parts of a name that a translation may (and usually should) translate:
# "the Russian River" is "el río Russian" in Spanish. The distinctive part must stay.
GENERIC = {"River", "Creek", "Lake", "Bay", "Mount", "Mountain", "Mountains", "Valley", "County", "City",
           "Island", "Islands", "Coast", "Beach", "Park", "National", "State", "North", "South", "East", "West",
           "Northern", "Southern", "Eastern", "Western", "Central", "Upper", "Lower"}


def names(text: str) -> set[str]:
    """Proper names in English text: capitalised words that don't start a sentence, joined
    into runs ("Russian River", "National Weather Service"). A translation must keep them
    verbatim: a renamed river or town sends people to the wrong place."""
    text = re.sub(r"\b(St|Mt|Ft|Pt)\.", r"\1", text)          # "St. Johns River" is one name
    found, run, prev = set(), [], "."
    for i, w in enumerate(re.findall(r"[\w'’-]+|[.!?:;,()]", text)):
        initial = i == 0 or re.fullmatch(r"[.!?:;]", prev)
        if re.fullmatch(r"[A-Z][a-z'’-]+", w) and not initial:
            run.append(w)
        else:
            if run:
                found.add(" ".join(run))
            run = []
        prev = w
    if run:
        found.add(" ".join(run))
    # A lone generic word ("River" after a split, "North") isn't a name to protect.
    return {n for n in found if any(w not in GENERIC for w in n.split())}


def _kept(name: str, text: str) -> bool:
    distinctive = [w for w in name.split() if w not in GENERIC]
    return name in text or (bool(distinctive) and all(w in text for w in distinctive))


def check(source: dict, out: dict) -> str | None:
    """None if `out` is an acceptable translation of `source`, else why not."""
    if not _same_shape(source, out):
        return "different structure"
    for s, t in zip(_flatten(source), _flatten(out), strict=True):
        if s.strip() and not t.strip():
            return "empty field"
        if len(t) > 3 * len(s) + 40:
            return "much longer than the original"
        if sorted(re.findall(MARKER, s)) != sorted(re.findall(MARKER, t)):
            return "citation markers changed"
        src, got = numbers(re.sub(MARKER, "", s)), numbers(re.sub(MARKER, "", t))
        if missing := [n for n in set(src) if src.count(n) > got.count(n)]:
            return f"numbers lost: {missing}"
        if renamed := sorted(n for n in names(s) if not _kept(n, t)):
            return f"names changed: {renamed}"
    return None


def parse(raw: str) -> dict:
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    return json.loads(raw[raw.find("{"): raw.rfind("}") + 1])


async def localize(llm, fields: dict, lang: str) -> dict | None:
    """`fields` translated into `lang` (a LANGUAGES code), or None to fall back to English.
    One retry: a rejected translation is usually fine the second time."""
    keep = {n for v in _flatten(fields) for n in names(v)}
    for _ in range(2):
        try:
            resp = await llm.ainvoke(PROMPT.format(
                language=LANGUAGES[lang], payload=json.dumps(fields, ensure_ascii=False),
                names=", ".join(sorted(keep)) or "none"))
            out = parse(resp.content if isinstance(resp.content, str) else str(resp.content))
        except Exception as e:  # noqa: BLE001 - model, network or JSON problems all mean "stay in English"
            log.info("localization to %s failed: %s", lang, type(e).__name__)
            continue
        if not (problem := check(fields, out)):
            return out
        log.info("localization to %s rejected: %s", lang, problem)
    return None


@cache
def nano():
    """The translating model, or None when Token Factory isn't configured (everything stays English).
    Super, not Nano: Nano added facts in some languages; Super with reasoning off is as fast."""
    from moby.config import get_settings
    from moby.llm import chat_model

    if get_settings().token_factory_api_key is None:
        return None
    # Translation needs no reasoning: with it off, a call takes 1-3 s and ~80 output tokens
    # (measured), instead of ~13 s and ~1,300 with it on.
    return chat_model("super", temperature=0, max_tokens=800,
                      extra_body={"chat_template_kwargs": {"enable_thinking": False}})


async def explanation_in(conn: AsyncConnection, row: dict, lang: str) -> dict | None:
    """An event's explanation (+ its headline) in `lang`: {"headline", "summary", "actions"}.

    `row` holds the event's columns (as to_alert needs them) plus `explainer`. Translated
    once per event and language, then cached in events.explainer->'localized'; a failed
    attempt is cached as null so it isn't retried (and paid for) by every reader.
    """
    from moby.api.alerts import to_alert

    from . import budget

    explainer = row.get("explainer") or {}
    cache_ = explainer.get("localized") or {}
    if lang in cache_:
        return cache_[lang]
    llm = nano()
    if llm is None or not explainer.get("summary") or not await budget.take(conn, "localize"):
        return None
    fields = {"headline": to_alert(row)["headline"], "summary": explainer["summary"],
              "actions": list(explainer.get("actions") or [])}
    out = await localize(llm, fields, lang)
    await conn.execute(
        "UPDATE events SET explainer = jsonb_set(explainer, '{localized}', "
        "coalesce(explainer->'localized', '{}'::jsonb) || jsonb_build_object(%s::text, %s::jsonb)) "
        "WHERE event_id = %s AND explainer IS NOT NULL",
        (lang, Jsonb(out), row["event_id"]))
    return out
