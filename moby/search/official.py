"""Official sources per country, for every Tavily search Moby makes.

Used by scripts/discover_guidance_sources.py and Ask Moby (moby/ai/ask.py).
"""

# Official domains only: national disaster agencies, met services, civil protection and
# official tourism boards' safety pages. Extend with care.
OFFICIAL: dict[str, list[str]] = {
    "US": ["ready.gov", "weather.gov", "fema.gov", "cdc.gov"],
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
