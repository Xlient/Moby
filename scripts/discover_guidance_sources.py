"""Find candidate official safety-guidance pages for a country (travellers' guidance).

    uv run --env-file .env python scripts/discover_guidance_sources.py JP [--hazard flood ...]

Searches ONLY the country's official government and agency domains (moby/search/official.py) with
Tavily, and prints candidates for a person to check. Nothing is added automatically: a
page joins moby/jobs/guidance.py SOURCES[country] only after someone has read it and confirmed
it's official, current, and allows automated reading.

Cost: one Tavily search (1 credit) per hazard, two where LOCAL_QUERIES has the country.
"""
import argparse
import sys

from moby.search.official import OFFICIAL
from moby.search.tavily import Tavily, TavilyNotConfigured

QUERIES = {
    "earthquake": "what to do during an earthquake safety advice",
    "flood": "what to do in a flood safety advice",
    "storm": "typhoon hurricane storm safety what to do",
    "fire": "wildfire safety what to do evacuate",
    "landslide": "landslide safety what to do",
    "other": "volcano eruption tsunami safety what to do",
}

# Official pages in some countries are mostly in the local language, so search in it too.
LOCAL_QUERIES = {
    "CN": {
        "earthquake": "地震 避险 自救 科普",
        "flood": "暴雨 洪水 山洪 避险 科普",
        "storm": "台风 雷电 预警信号 防御指南",
        "fire": "森林火灾 山火 逃生 科普",
        "landslide": "滑坡 泥石流 户外 避险",
        "other": "自然灾害 自救 知识",
    },
}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("country", choices=sorted(OFFICIAL))
    p.add_argument("--hazard", choices=list(QUERIES), action="append")
    args = p.parse_args()
    try:
        tavily = Tavily()
    except TavilyNotConfigured:
        sys.exit("TAVILY_API_KEY is not set (add it to .env)")

    domains = OFFICIAL[args.country]
    print(f"# Candidate guidance sources: {args.country} (official domains: {', '.join(domains)})\n")
    print("Check each page yourself before adding it to SOURCES[country] in moby/jobs/guidance.py.\n")
    for hazard in args.hazard or list(QUERIES):
        results = tavily.search(QUERIES[hazard], include_domains=domains, max_results=5)
        if local := LOCAL_QUERIES.get(args.country, {}).get(hazard):
            seen = {r.url for r in results}
            results += [r for r in tavily.search(local, include_domains=domains, max_results=5) if r.url not in seen]
        print(f"## {hazard}\n")
        if not results:
            print("_No results on official domains._\n")
            continue
        for r in results:
            print(f"- [{r.title or r.url}]({r.url}) (score {r.score:.2f})\n  > {r.content[:200].strip()}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
