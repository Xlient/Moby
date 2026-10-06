"""Find candidate official safety-guidance pages for a country (travellers' guidance).

    uv run --env-file .env python scripts/discover_guidance_sources.py JP [--hazard flood ...]

Searches ONLY the country's official government and agency domains (OFFICIAL below) with
Tavily, and prints candidates for a person to check. Nothing is added automatically: a
page joins moby/jobs/guidance.py SOURCES only after someone has read it and confirmed
it's official, current, and allows automated reading.

Cost: one Tavily search (1 credit) per hazard.
"""
import argparse
import sys

from moby.search.tavily import Tavily, TavilyNotConfigured

# Official domains only: national disaster agencies, met services, civil protection and
# official tourism boards' safety pages. Extend with care.
OFFICIAL: dict[str, list[str]] = {
    "JP": ["bousai.go.jp", "jma.go.jp", "fdma.go.jp", "japan.travel"],
    "ID": ["bnpb.go.id", "bmkg.go.id"],
    "PH": ["ndrrmc.gov.ph", "pagasa.dost.gov.ph", "phivolcs.dost.gov.ph"],
    "MX": ["gob.mx"],
    "IT": ["protezionecivile.gov.it"],
    "GR": ["civilprotection.gov.gr"],
    "IS": ["almannavarnir.is", "safetravel.is"],
    "NZ": ["civildefence.govt.nz", "getready.govt.nz"],
    "NP": ["bipad.gov.np", "drrportal.gov.np", "neoc.gov.np"],
    "ES": ["proteccioncivil.es", "aemet.es"],
    "PT": ["prociv.gov.pt"],
    "IN": ["ndma.gov.in"],
    "TH": ["disaster.go.th", "tmd.go.th"],
}

QUERIES = {
    "earthquake": "what to do during an earthquake safety advice",
    "flood": "what to do in a flood safety advice",
    "storm": "typhoon hurricane storm safety what to do",
    "fire": "wildfire safety what to do evacuate",
    "landslide": "landslide safety what to do",
    "other": "volcano eruption tsunami safety what to do",
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
    print("Check each page yourself before adding it to SOURCES in moby/jobs/guidance.py.\n")
    for hazard in args.hazard or list(QUERIES):
        results = tavily.search(QUERIES[hazard], include_domains=domains, max_results=5)
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
