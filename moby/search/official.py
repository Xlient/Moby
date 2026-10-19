"""Official sources per country, for every Tavily search Moby makes.

Used by scripts/discover_guidance_sources.py and Ask Moby (moby/ai/ask.py).
"""

# Official domains only: national disaster agencies, met services, civil protection and
# official tourism boards' safety pages. Extend with care.
OFFICIAL: dict[str, list[str]] = {
    "US": ["ready.gov", "weather.gov", "fema.gov", "cdc.gov"],
    "JP": ["bousai.go.jp", "jma.go.jp", "fdma.go.jp", "jnto.go.jp", "japan.travel"],
    "ID": ["bnpb.go.id", "bmkg.go.id"],
    "PH": ["ndrrmc.gov.ph", "pagasa.dost.gov.ph", "phivolcs.dost.gov.ph"],
    "MX": ["gob.mx"],
    "IT": ["protezionecivile.gov.it"],
    "GR": ["civilprotection.gov.gr"],
    "IS": ["almannavarnir.is", "safetravel.is"],
    "NZ": ["civildefence.govt.nz", "getready.govt.nz"],
    "NP": ["bipad.gov.np", "ndrrma.gov.np", "drrportal.gov.np", "neoc.gov.np", "dhm.gov.np"],
    "ES": ["proteccioncivil.es", "aemet.es"],
    "PT": ["prociv.gov.pt"],
    "IN": ["ndma.gov.in"],
    "TH": ["disaster.go.th", "tmd.go.th"],
    # Mainland China. MEM (emergency management), CMA (weather), CEA (earthquakes), MNR
    # (geological hazards), MWR (floods), 12379.cn (national Emergency Warning Release
    # Center, under CMA) and gov.cn (State Council; provincial and city governments are
    # subdomains of it). CEA answers automated fetches with 403, so it's here for search
    # results only.
    "CN": ["mem.gov.cn", "cma.gov.cn", "cea.gov.cn", "mnr.gov.cn", "mwr.gov.cn", "12379.cn", "gov.cn"],
}


# ── Web sources in a situational brief ────────────────────────────────────────────────────
#
# Trust stays visible (decided 2026-10-19): a page from a government site counts as official;
# a news outlet is a "News report" (it reports what agencies said; it isn't one); social media
# is never searched (exclude_domains), because posts there can't be counted or checked.

# Never searched: pass as Tavily's exclude_domains.
SOCIAL_DOMAINS = [
    "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com",
    "youtube.com", "threads.net", "t.me", "telegram.org", "pinterest.com", "linkedin.com",
    "weibo.com", "vk.com", "medium.com", "substack.com", "quora.com",
]

# Government-only domain endings: registries only hand these to public bodies.
_GOVERNMENT_SUFFIXES = (".gov", ".gov.uk", ".govt.nz", ".go.jp", ".go.id", ".go.th", ".go.kr", ".gob.mx", ".gouv.fr")
_GOVERNMENT_PARTS = (".gov.", ".gob.", ".go.")    # e.g. ndrrmc.gov.ph, pagasa.dost.gov.ph, gob.es


def _host(url: str) -> str:
    from urllib.parse import urlparse
    host = (urlparse(url if "//" in url else f"//{url}").hostname or "").lower()
    return host.removeprefix("www.")


def _matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def web_source_kind(url: str) -> str | None:
    """'official' for a government site (one of OFFICIAL's domains, or a government-only domain
    like .gov / .go.jp / .gov.ph); None for social media (leave it out); otherwise 'news'."""
    host = _host(url)
    if not host or any(_matches(host, d) for d in SOCIAL_DOMAINS):
        return None
    if any(_matches(host, d) for domains in OFFICIAL.values() for d in domains):
        return "official"
    if host.endswith(_GOVERNMENT_SUFFIXES) or any(p in f".{host}." for p in _GOVERNMENT_PARTS):
        return "official"
    return "news"


def canonical_url(url: str) -> str:
    """The same page written differently (http/https, www., trailing slash, #fragment) → one
    key, for dropping duplicate search results."""
    from urllib.parse import urlparse
    u = urlparse(url if "//" in url else f"//{url}")
    path = u.path.rstrip("/") or "/"
    return f"{_host(url)}{path}{'?' + u.query if u.query else ''}"


def site_name(url: str) -> str:
    """The domain to show next to a web source ("weather.gov", "reuters.com")."""
    return _host(url)
