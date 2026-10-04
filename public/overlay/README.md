<div align="center">

# Moby — early warnings that reach you

**An open-source disaster early-warning app for locals and travellers.**
Moby brings official hazard warnings from around the world and reports from people on the ground
into one calm, trustworthy app, and helps you know what to do, even with little or no signal.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
![Android](https://img.shields.io/badge/Android-Expo%20%2F%20React%20Native-3DDC84)
[![CI](https://github.com/Xlient/Moby/actions/workflows/ci.yml/badge.svg)](https://github.com/Xlient/Moby/actions/workflows/ci.yml)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Xlient)

</div>

> ⚠️ **Moby complements official warning systems; it does not replace them.** Always follow
> instructions from local authorities and emergency services.

---

## Why

Floods, wildfires, landslides, typhoons and earthquakes are most dangerous exactly where warnings
struggle to arrive: trekking routes, islands, rural valleys, and anywhere you don't speak the
language. Moby is built for that moment:

- **Official warnings, wherever you are.** National weather and geological services, tsunami and
  cyclone warning centres, in one place, shown only when they're near you.
- **Trust you can see.** An agency warning, a report confirmed by several people nearby, and a single
  unverified report always look different. A rumour never looks like a government warning.
- **In your language.** Warnings issued in other languages are translated, clearly labelled, and the
  original is always one tap away.
- **Works offline.** Safety guidance from official sources and local emergency numbers stay on your
  phone.
- **Calm until it matters.** Critical alerts near you always get through, whatever your settings.

## This repository

This is the **Moby mobile app** (Expo / React Native) and its **API contract**
([`api-contract-v1.yaml`](api-contract-v1.yaml)). The Moby service behind that API (warning feeds,
AI pipeline, database) is operated by the maintainer and isn't part of this repository, and only the
official signed app can call it. You don't need it: **the app runs on built-in sample data**, so you
can explore and change every screen right away.

Want to change the API? Edit `api-contract-v1.yaml`, run `npm run generate-types`, update the
sample data in `src/api/fixtures.ts`, and describe the change in your pull request. The maintainer
implements it on the service side.

## Quick start

Requires Node.js 22+, Android Studio (SDK + an emulator) and **JDK 17**.

```bash
git clone https://github.com/Xlient/Moby.git && cd Moby
npm install
npx expo run:android
```

Checks run on every pull request:

```bash
npm run typecheck
npm run lint
```

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Two principles
hold in every change:

1. **Trust stays visible.** Unverified reports must never look like official warnings.
2. **Never a false all-clear.** If the app can't check, it says so; it never shows "all quiet".

Found a security problem? Please follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Support Moby

Moby is free and open source, built by one independent developer. If it's useful to you, please
consider [sponsoring the project](https://github.com/sponsors/Xlient). Sponsorship keeps alerts
running for everyone and funds development: offline mesh relay, more regions, and safety guidance.

## Data sources & acknowledgements

Warnings come from official services including the US National Weather Service, USGS, NASA EONET,
GDACS, the Pacific Tsunami Warning Center, the National Hurricane Center, the Joint Typhoon Warning
Center, EMSC, the Japan Meteorological Agency, MeteoAlarm and its member services, and national
services publishing via the WMO/IFRC Alert Hub. Safety guidance comes from FEMA (Ready.gov) and the
National Weather Service. Emergency numbers come from the UK Foreign, Commonwealth & Development
Office's travel advice. These organisations do not endorse Moby.

## License

Moby is free software, licensed under the [GNU General Public License v3.0](LICENSE).
