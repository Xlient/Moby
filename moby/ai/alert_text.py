"""Official alerts in the phone's language: a Spanish warning on a Japanese phone reads in
Japanese, translated straight from the agency's Spanish (not through English).

The ingest translator (moby/feeds/translate.py) still makes the checked English that
explanations and Ask Moby are grounded in; this is for reading the alert itself. Same
guardrails: translate only, every number in the original must survive, no much-longer
output, and (when the original is English) place and agency names must survive too. If
anything fails, the reader gets what they got before: the English translation, or the
original. The app always labels it "Translated by Moby", with the original one tap away.

Made the first time someone with that language opens the alert, or is pushed it, and
cached per event and language in events.translations (migration 0025).
"""
import logging
import re
from functools import cache

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from moby.feeds.translate import Translation, check as check_numbers, parse

from . import budget
from .localize import LANGUAGES, _kept, names, normalize

log = logging.getLogger("moby.ai.alert_text")

BODY_CHARS = 1200       # the app shows the first 600 characters of a body; leave room for wordier languages

PROMPT = """Translate this official emergency warning from {source} into {target}, for a member of the
public reading it on their phone.

Rules:
- Translate faithfully. Do not summarise, soften, add advice or explain.
- Keep every number, time, date, level and unit exactly as written, in Western digits (0-9).
- Keep names of places, rivers, regions and agencies in their original letters, exactly as
  written; you may add the {target} spelling in brackets after a name. Names in this text: {names}
- If a field is empty, return an empty string for it.

Return ONLY JSON: {{"headline": "...", "body": "..."}}

headline: {headline}
body: {body}"""


def base(tag: str | None) -> str:
    """'es-MX' → 'es'; English when unknown (NWS and most feeds don't say)."""
    return (tag or "en").replace("_", "-").split("-")[0].lower() or "en"


def same_language(row: dict, lang: str | None) -> bool:
    """The phone reads the agency's own language: show the original, untranslated."""
    return lang is not None and base(lang) == base(row.get("language"))


def cached(row: dict, lang: str | None) -> dict | None:
    """A translation already made for the phone's language (no model call)."""
    code = normalize(lang)
    return (row.get("translations") or {}).get(code) if code else None


@cache
def model():
    """Super with reasoning off, as for localize.py: Nano added facts in some languages.
    None when Token Factory isn't configured."""
    from moby.config import get_settings
    from moby.llm import chat_model

    if get_settings().token_factory_api_key is None:
        return None
    return chat_model("super", temperature=0, max_tokens=2500,
                      extra_body={"chat_template_kwargs": {"enable_thinking": False}})


def source_name(row: dict) -> str:
    from moby.api.alerts import LANGUAGE_NAMES
    code = base(row.get("language"))
    return "English" if code == "en" else LANGUAGE_NAMES.get(code) or LANGUAGES.get(code) or row.get("language")


# Title-cased hazard words in NWS text ("threats of Flash Flooding") aren't names to protect.
HAZARD_WORDS = {"Flash", "Flood", "Flooding", "Floods", "Warning", "Watch", "Advisory", "Statement", "Storm",
                "Thunderstorm", "Thunderstorms", "Severe", "Winter", "Weather", "Fire", "Red", "Flag", "Heat",
                "Excessive", "Extreme", "Wind", "High", "Freeze", "Frost", "Tornado", "Hurricane", "Tropical",
                "Dense", "Fog", "Snow", "Ice", "Blizzard", "Dust", "Air", "Quality", "Alert",
                # and days and months, which should be translated
                "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
                "January", "February", "March", "April", "May", "June", "July", "August", "September",
                "October", "November", "December"}


def protected_names(*texts: str) -> set[str]:
    """Place and agency names in English agency text. NWS writes in lines and bullets
    ("* WHERE...", "- An upper-level trough…"): each starts a sentence, not a name."""
    found = set()
    for text in texts:
        prose = re.sub(r"\s*(?:\n|^)\s*(?:[-*•]\s*)?", ". ", text or "")
        found |= {n for n in names(prose) if any(w not in HAZARD_WORDS for w in n.split())}
    return found


# Languages not written in Latin letters. Super writes well-known names in their script
# ("アリゾナ州" for Arizona) whatever the prompt says: correct for the reader, but not what a
# road sign or map says, so names it rewrote are listed before the text as written (📍 Arizona).
# In Latin-script languages a name must stay as written, or the translation is rejected.
OTHER_SCRIPTS = {"ru", "ja", "ko", "zh", "th", "hi"}


def check(headline: str, body: str, t: Translation, *, english_source: bool, code: str) -> str | None:
    """None if acceptable (names the reader needs may have been appended to t.body), else why not."""
    if problem := check_numbers(headline, body, t):
        return problem
    if english_source:
        out = f"{t.headline}\n{t.body}"
        if renamed := sorted(n for n in protected_names(headline, body) if not _kept(n, out)):
            if code not in OTHER_SCRIPTS:
                return f"names changed: {renamed[:4]}"
            # First, so the app's 600-character body never cuts it off.
            t.body = " · ".join(f"📍 {n}" for n in renamed) + f"\n\n{t.body}"
    return None


async def translate(llm, row: dict, code: str) -> dict | None:
    """The agency's headline and body in LANGUAGES[code], or None if it fails its checks.
    One retry: a rejected translation is usually fine the second time."""
    from moby.api.alerts import _headline
    # The headline the app shows: the agency's title, or for English feeds Moby's short one
    # ("Flood warning", not "Flood Warning issued October 20 at 12:37AM MST until…").
    english = base(row.get("language")) == "en"
    headline = (_headline(row) if english else row.get("title") or row.get("product") or "")[:300]
    body = (row.get("description") or "")[:BODY_CHARS]
    keep = sorted(protected_names(headline, body)) if english else []
    msg = PROMPT.format(source=source_name(row), target=LANGUAGES[code], headline=headline, body=body,
                        names=", ".join(keep) or "as they appear")
    for _ in range(2):
        try:
            resp = await llm.ainvoke(msg)
            t = parse(resp.content if isinstance(resp.content, str) else str(resp.content))
        except Exception as e:  # noqa: BLE001 - model, network or JSON problems all mean "fall back"
            log.info("alert translation to %s failed for %s: %s", code, row.get("event_id"), type(e).__name__)
            continue
        if not (problem := check(headline, body, t, english_source=english, code=code)):
            return {"headline": t.headline, "body": t.body}
        log.info("alert translation to %s rejected for %s: %s", code, row.get("event_id"), problem)
    return None


async def alert_in(conn: AsyncConnection, row: dict, lang: str | None) -> dict | None:
    """The official alert in the phone's language, translating it now if it hasn't been yet.
    Updates row["translations"] so to_alert(row, lang) shows it. None when there's nothing to
    do (community report, the phone reads the original, a language Moby doesn't translate
    into) or it can't be done (no key, over budget, failed checks)."""
    code = normalize(lang)
    if row.get("source") != "official" or code is None or same_language(row, lang) or row.get("alert_headline"):
        return None
    translations = row["translations"] = dict(row.get("translations") or {})
    if code in translations:
        return translations[code]
    llm = model()
    if llm is None or not await budget.take(conn, "alert_language"):
        return None
    out = await translate(llm, row, code)
    translations[code] = out
    await conn.execute(
        "UPDATE events SET translations = translations || jsonb_build_object(%s::text, %s::jsonb) WHERE event_id = %s",
        (code, Jsonb(out), row["event_id"]))
    return out
