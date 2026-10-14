"""Checks that keep model output tied to its sources (shared by translation, guidance,
explanations and Ask Moby). A model may rephrase; it may not add facts or numbers."""
import re

STOP = set("""a an and are as at be been but by can do does don't for from get go has have if in into
is it its keep make may more must no not of on or our out over own so some stay such than that the
their them then there these they this those through to up use very was we what when where which
while who will with you your yourself""".split())


def norm(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return " ".join(re.sub(r"[^\w\s'%-]", " ", s.lower()).split())


def numbers(text: str) -> list[str]:
    """Numbers as written, with decimal commas normalised ('2,5' == '2.5')."""
    return [n.replace(",", ".") for n in re.findall(r"\d+(?:[.,]\d+)?", text or "")]


def stray_numbers(output: str, source: str) -> list[str]:
    """Numbers in the output that aren't in the source (invented or changed)."""
    have = set(numbers(source))
    return sorted({n for n in numbers(output) if n not in have})


def content_words(s: str) -> set[str]:
    words = (w.strip("'-") for w in norm(s).split())
    return {w for w in words if len(w) > 2 and w not in STOP}


def support(output: str, source: str) -> float:
    """Share of the output's content words that also appear in the source."""
    words = content_words(output)
    return len(words & content_words(source)) / max(1, len(words))
