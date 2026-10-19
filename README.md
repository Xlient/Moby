<div align="center">

# Moby: early warnings that reach you

**An open-source disaster early-warning app for locals and travellers in places where official alerts don't reach.**
Moby brings official hazard warnings from around the world together with reports from people on the ground,
explains them in plain words with NVIDIA Nemotron, and tells you what to do, even with little or no signal.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![CI](https://github.com/Xlient/Moby/actions/workflows/ci.yml/badge.svg)](https://github.com/Xlient/Moby/actions/workflows/ci.yml)
![Android](https://img.shields.io/badge/Android-Expo%20%2F%20React%20Native-3DDC84)
![iOS](https://img.shields.io/badge/iOS-Simulator%20build-000000?logo=apple)
![Models](https://img.shields.io/badge/Models-NVIDIA%20Nemotron%20on%20Nebius%20Token%20Factory-76B900)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Xlient)

</div>

> ⚠️ **Moby complements official warning systems; it does not replace them.** Always follow
> instructions from local authorities and emergency services.

**Contents:** [Get Moby](#get-moby) · [Run from source](#run-from-source) · [What Moby is](#what-moby-is) ·
[Models](#the-models) · [Architecture](#architecture) · [Sponsoring](#sponsoring) ·
[Contributing](#contributing) · [Security](#security) · [License](#license)

---

## Get Moby

| Platform | Where | Status |
|---|---|---|
| **Android** (phone or emulator) | `Moby-<version>.apk` on [GitHub Releases](https://github.com/Xlient/Moby/releases) | Built and signed by [`android-release.yml`](.github/workflows/android-release.yml) on every `v*` tag. **TODO: no release is tagged yet**, so the Releases page is empty until the first `v0.1.0` tag. |
| **Android, Google Play** | Not listed | The release workflow can upload to a Play testing track, but there is no public listing or opt-in link yet. **TODO:** add the closed-test link here once it exists. |
| **iOS Simulator** (Mac) | `Moby-simulator.zip` on [GitHub Releases](https://github.com/Xlient/Moby/releases) | Built by [`ios-simulator.yml`](.github/workflows/ios-simulator.yml) and attached to the same `v*` release. |
| **iPhone (device)** | Not on the App Store or TestFlight | Both need a paid Apple Developer membership. Build it onto your own iPhone from source instead: [iOS](#ios). |
| **Web** | No hosted version | Run it in your browser with demo data in about 2 minutes: [demo mode](#a-the-app-with-demo-data-2-minutes). |

**Sign in** with any Google account, or (judges) the test account in the Devpost testing instructions.

**The live API.** The release builds talk to Moby's API, which runs on a Nebius Serverless Endpoint and
stays up at the same address through the end of judging (15 December 2026). Its address is built into the
release builds rather than published: every request needs a Firebase App Check token that only the official
signed app can get, so the app is the way in. A health check runs every 30 minutes
([`uptime.yml`](.github/workflows/uptime.yml)). Builds from source without an API address run on built-in demo data.

### Android

1. On an emulator: install [Android Studio](https://developer.android.com/studio), open **Device Manager**,
   create any Pixel phone with a recent Google APIs image, and start it.
2. Download `Moby-<version>.apk` from [Releases](https://github.com/Xlient/Moby/releases) and drag it onto the
   emulator window, or run `adb install Moby-<version>.apk`. On a real phone, open the file and allow installing
   from your browser.
3. Open **Moby**. Allow location, or leave it off to see alerts around San Francisco.

### iOS

Needs a Mac with Xcode (no Apple account). Open Xcode once and accept the iOS Simulator download it offers
(or run `xcodebuild -downloadPlatform iOS`). Download `Moby-simulator.zip` from
[Releases](https://github.com/Xlient/Moby/releases), unzip it to get `Moby.app`, then:

```bash
open -a Simulator
xcrun simctl install booted Moby.app
xcrun simctl launch booted com.xlient.moby
```

Set a location with the Simulator's **Features → Location** menu. Push notifications need an Apple Developer
membership, so they're Android-only for now.

### A five-minute tour

1. **Home:** official alerts near you, within a radius you choose. Each shows who issued it and how sure Moby is.
2. **Open an official alert:** *What this means for you* explains it in plain words. The agency's own text is
   right below, and non-English warnings are translated with the original one tap away.
3. **What to do:** safety guidance and local emergency numbers, saved on the phone so they work offline.
4. **Assistant (Ask Moby):** ask "What should I do if the road ahead is flooded?". The answer cites its sources,
   and Moby says it can't answer rather than guessing. Download the offline model to ask with no signal.
5. **Before you go:** pick a destination (Phakding, Nepal) or a route (Lukla → Phakding → Namche Bazaar) for a trip
   brief you can save offline, or check whether a drive crosses a known hazard.
6. **Settings → About → How Moby uses AI:** which model does what, and what AI never decides.

---

## Run from source

### Requirements

| For | You need |
|---|---|
| The app | Node.js 22 (CI uses 22; 20+ works), npm |
| Android builds | Android Studio (SDK and an emulator) and **JDK 17**: React Native's native build fails on newer JDKs |
| iOS builds | macOS, Xcode with an iOS Simulator runtime, CocoaPods (`brew install cocoapods`) |
| The backend | Docker, [uv](https://docs.astral.sh/uv/) (Python 3.14 is installed for you from `.python-version`) |

### A. The app with demo data (2 minutes)

No backend, accounts or keys: without `EXPO_PUBLIC_API_URL` the app uses built-in sample alerts,
explanations and answers (`src/api/fixtures.ts`).

```bash
git clone https://github.com/Xlient/Moby.git && cd Moby
npm ci
EXPO_PUBLIC_USE_MOCK=true npx expo start --web
```

Press `w` if the browser doesn't open, and use a phone-sized window. On an Android emulator, with JDK 17:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)   # macOS; elsewhere point JAVA_HOME at JDK 17
export ANDROID_HOME=$HOME/Library/Android/sdk      # Linux: ~/Android/Sdk
npx expo run:android --variant release
```

On iOS: `MOBY_PREBUILD_PLATFORM=ios npx expo run:ios --configuration Release`. To put it on your own iPhone,
add `--device` with the phone plugged in and sign in to Xcode with any Apple ID; free signing lasts 7 days.

**App scripts** (`package.json`):

| Command | What it does |
|---|---|
| `npm start` / `npm run web` | Expo dev server (native / browser) |
| `npm run android` | Build and run on Android (`expo run:android`) |
| `npm run typecheck` · `npm run lint` | TypeScript and ESLint, both run in CI |
| `npm run test:lib` · `test:mesh` · `test:guidance` · `test:ondevice` | Unit tests (Node's test runner) |
| `npm run generate-types` | Regenerate `src/api/generated-types.ts` from [`api-contract-v1.yaml`](api-contract-v1.yaml) |
| `npm run emulators` · `npm run test:rules` | Firebase emulators and the Firestore rules tests |
| `npm run build:android:apk` | EAS cloud build (`preview` profile in [`eas.json`](eas.json)) |

### B. The full stack

**1. Database and live feeds.** [`docker-compose.yml`](docker-compose.yml) starts Postgres 17 (PostGIS +
pgvector), runs the migrations, and starts the feed poller, the report fusion worker and the brief worker.
The poller begins pulling real official alerts within a minute.

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f poller        # Ctrl-C when you see feeds succeed
```

**2. The API** (FastAPI, `moby/api/app.py`). Sign-in is switched off for local use:

```bash
uv sync
MOBY_AUTH_DISABLED=true MOBY_CORS_ORIGINS=http://localhost:8081 \
  uv run --env-file .env uvicorn moby.api.app:app --port 8000
curl "http://localhost:8000/v1/alerts?lat=37.77&lon=-122.42&radius_km=300"
```

**3. The app against your API.** In a browser, or on the Android emulator (which reaches your machine at `10.0.2.2`):

```bash
EXPO_PUBLIC_USE_MOCK=false EXPO_PUBLIC_API_URL=http://localhost:8000/v1 npx expo start --web
```

```bash
EXPO_PUBLIC_USE_MOCK=false EXPO_PUBLIC_API_URL=http://10.0.2.2:8000/v1 npx expo run:android
```

**4. AI and routing (optional).** Add keys to `.env`, then restart the API and the poller:

- `N_FACTORY_ACC_KEY`: a [Nebius Token Factory](https://tokenfactory.nebius.com/) key. Turns on translation,
  *What this means for you*, Ask Moby, trip briefs and situational briefs.
- `TAVILY_API_KEY`: a [Tavily](https://tavily.com/) key. Ask Moby and trip briefs can then search official government websites.
- `ORS_API_KEY`: a free [OpenRouteService](https://openrouteservice.org/dev/#/signup) key for the route hazard check.

```bash
docker compose up -d poller
uv run --env-file .env python -m moby.feeds --once explain   # embed guidance for Ask Moby
uv run --env-file .env python scripts/verify_models.py       # check the key reaches Nano, Super, Ultra and the embedder
```

Without keys, everything else works: alerts, maps, guidance and reports.

**Tests:** `uv run --env-file .env pytest` (backend; uses the Docker database) and the app commands above.
Evaluations that call models run only in the gated [`model-evals`](.github/workflows/model-evals.yml) workflow.
`main.py` at the root is empty; the entry points are `moby.api.app`, `python -m moby.feeds` and
`python -m moby.delivery`. Deployment to Nebius is `deploy/nebius/deploy.sh` (maintainer only).

---

## What Moby is

Floods, typhoons, earthquakes and wildfires are most dangerous where warnings struggle to arrive: trekking
routes, valleys, islands, rural areas, places where towers fail first. Travellers have it worst: warnings come
in a language they don't read, from agencies they've never heard of. Moby is built for that moment.

| Problem | What Moby does |
|---|---|
| **Warnings don't reach remote, low-signal places** | Watches official sources worldwide (NWS, USGS, EMSC, GDACS, NASA EONET, PTWC, NHC, JTWC, JMA, Nepal's BIPAD, MeteoAlarm and national Common Alerting Protocol feeds) and pushes the ones near you and your saved places. Critical alerts near you always get through, whatever your settings. |
| **A rumour can look like a government warning** | Trust is visible. Every item is labelled **Official** (an agency issued it) or **Unverified** (reports from people nearby, with how many people reported). Community reports never wait for a reviewer and never look official; each user chooses whether to hear about them. |
| **Warnings in a language you don't read** | Translated (every number checked against the original) and explained in plain words in 17 languages, with the agency's text one tap away. |
| **No signal when it matters** | Offline guidance: safety steps from official sources and local emergency numbers stay on the phone, and Ask Moby can answer offline with an on-device model. |
| **No signal and you need help** | **Bluetooth mesh SOS** (Android, opt-in): send an SOS and the latest alerts phone to phone. Nearby Moby phones repeat it for up to 6 hours and upload it when one of them gets a connection. |
| **Is the road ahead safe?** | **Route hazard check:** does the usual route cross an active official warning or community report, and is there one around it? Moby never calls a route safe; it only says what it knows about. |
| **Planning a trip somewhere unfamiliar** | **Trip briefs** (*Before you go*): for a destination or route, every alert and report around it, explained with sources and saved offline with the emergency numbers. |

Two rules hold everywhere: **never a false all-clear** (if Moby can't check, it says so, never "all quiet"),
and **models never decide whether something is confirmed or how urgent it is**: those are plain rules in
`moby/escalation/`.

---

## The models

Server-side models run on [Nebius AI Studio / Token Factory](https://tokenfactory.nebius.com/) through its
OpenAI-compatible API. One place, `moby/llm.py` (model ids in `moby/config.py`), decides which tier each feature uses.
Every model call sits behind a check, and when a check fails the reader gets the official text instead.

| Model | Where | What it does | How it's kept honest |
|---|---|---|---|
| **NVIDIA Nemotron 3 Nano** (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) | Token Factory | Translates non-English warnings on ingest (`moby/feeds/translate.py`); rewrites Ask Moby questions into search queries with no personal details (`moby/ai/ask.py`); pulls structured details out of report notes (`moby/graph/structure.py`). | Every number in the original must survive translation, or the original is shown. Report extraction may only fill fields the note states. |
| **NVIDIA Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`) | Token Factory | *What this means for you* for each official warning, also used in the push notification (`moby/ai/explain.py`); Ask Moby answers with `[n]` citations; translation of these into the phone's language (`moby/ai/localize.py`); "what changed" since the last brief (`moby/graph/brief_changes.py`). | Grounding checks (`moby/ai/grounding.py`): no number that isn't in the source, and the words must come from the cited sources, or it's withheld. Ask Moby abstains when its sources don't cover the question. |
| **NVIDIA Nemotron 3 Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`) | Token Factory | Trip briefs (`moby/ai/trip.py`); situational briefs for people near a hazard (`moby/graph/brief_writer.py`); synthesises the offline safety guidance cards from official pages such as Ready.gov and the NWS, as a Serverless Job (`moby/jobs/guidance.py`). | Every statement must cite an alert, report or official page, and its numbers, names and hazards must appear in what it cites, or it's dropped. Each guidance line cites the source line it came from. |
| **Qwen3-Embedding-8B** (1024-d) | Token Factory | Retrieval for Ask Moby over the guidance cards (pgvector), and event embeddings. | Similarity cut-offs measured on real questions. |
| **NVIDIA Nemotron 3 Nano 4B** (Q4_K_M GGUF, 2.8 GB) | **On the phone**, via [llama.rn](https://github.com/mybigday/llama.rn) | Offline Ask Moby (`src/ondevice/`): answers from the guidance saved on the phone, with no signal. Downloaded on request over Wi-Fi from NVIDIA's Hugging Face repo, never bundled; needs a phone with about 8 GB of RAM. | The same grounding rules run on the phone (`src/ondevice/grounding.ts`). `scripts/ondevice-eval.ts` evaluates it on a laptop with llama.cpp. |

`scripts/list_models.py` lists the models your Token Factory key can see; `scripts/verify_models.py` checks each tier
answers and the embedding dimension. Ask Moby and trip briefs search **only official government domains** with
[Tavily](https://tavily.com/) when Moby's own sources don't cover a question (`moby/search/official.py`). Every paid
call has a daily cap (`moby/ai/budget.py`); past it, features fall back to the official text.

**Why these tiers:** Nano for the high-volume, latency-sensitive work, Super for what people read interactively, Ultra
for slow, careful work done ahead of time, and a small Nano on the phone for when there's no network at all.

---

## Architecture

```mermaid
flowchart LR
  subgraph Sources
    Official[Official feeds<br/>NWS · USGS · EMSC · JMA · CAP …]
    People[Reports from people nearby]
  end
  Official --> Poller[Feed poller<br/>conditional polling, de-duplication]
  Poller --> Translate[Nemotron Nano<br/>number-checked translation]
  Poller --> DB[(Postgres<br/>PostGIS + pgvector)]
  Translate --> DB
  People --> API
  DB <--> Fusion[LangGraph fusion worker<br/>reports → events, labelled unverified]
  DB <--> Briefs[Brief worker<br/>Nemotron Ultra + Super]
  DB --> API[FastAPI]
  API --> Explain[Nemotron Super<br/>explanations · Ask Moby]
  Explain -. Tavily: official sites only .- Web((Official websites))
  API --> ORS[OpenRouteService<br/>route hazard check]
  API --> App[Moby app<br/>Expo · React Native]
  API --> Push[Push delivery · FCM]
  App <-. Bluetooth mesh .-> Phones((Nearby phones))
  App --> OnDevice[Nemotron 3 Nano 4B<br/>on the phone]
  Jobs[Serverless Jobs<br/>embeddings · backups · guidance with Ultra] <--> API
```

| Part | Where | What |
|---|---|---|
| App | `src/`, `modules/`, `plugins/` | Expo / React Native. Firebase Auth and Firestore for accounts, FCM for push, App Check, MapLibre maps, SQLite for offline data, a native Bluetooth module (`modules/moby-mesh`) for the mesh. |
| API contract | [`api-contract-v1.yaml`](api-contract-v1.yaml) | OpenAPI; the app's types are generated from it. |
| API | `moby/api/` | FastAPI: alerts, reports, guidance, Ask Moby, trips, routes, mesh sync, privacy export and deletion. |
| Feeds | `moby/feeds/` | One normaliser per network into one event schema, polled with ETag / If-Modified-Since, de-duplicated across networks and linked across updates. |
| Fusion and briefs | `moby/graph/` | LangGraph workers. The same hazard within 1 km and 2 hours becomes one event, counting distinct people. |
| Trust rules | `moby/escalation/`, `moby/alerts/` | Deterministic tiers and who gets notified. No model involved. |
| Delivery | `moby/delivery/` | Push notifications through FCM. |
| Data | `db/` | Postgres 17 with PostGIS (where things are) and pgvector (what they're about). |
| Hosting | `deploy/` | One Nebius Serverless Endpoint runs the API, Postgres, poller, push and AI workers; Serverless Jobs run embeddings, backups and guidance generation; MysteryBox holds secrets, Object Storage the backups. |

---

## Privacy

Moby collects as little as it can, and you can export or delete your data in the app (Settings → Privacy). See the
[privacy policy](legal/privacy.md) and [terms](legal/terms.md). Ask Moby questions aren't stored, and only the two
points of a route check leave for OpenRouteService.

## Built during the hackathon

Moby was started for the Nebius × NVIDIA Global AI Hackathon: the first commit is from 20 September 2026, inside the
submission period, and everything here was built during it.

## Data sources and acknowledgements

Warnings come from official services including the US National Weather Service, USGS, NASA EONET, GDACS, the Pacific
Tsunami Warning Center, the National Hurricane Center, the Joint Typhoon Warning Center, EMSC, the Japan Meteorological
Agency, Nepal's BIPAD portal, MeteoAlarm and its member services, and national services publishing Common Alerting
Protocol feeds. Safety guidance comes from FEMA (Ready.gov) and the National Weather Service. Routes come from
OpenRouteService and OpenStreetMap contributors. These organisations do not endorse Moby.

---

## Sponsoring

Moby is free and open source, built by one independent developer, and the live service costs money to run
(hosting, model calls, search). If it's useful to you or your organisation, please
[sponsor Moby on GitHub](https://github.com/sponsors/Xlient). [SPONSORS.md](SPONSORS.md) lists the tiers, what each
one gets, and the people and organisations who support Moby.

## Contributing

Contributions to every part of Moby are welcome: the app, the backend, feeds for new countries, translations,
safety guidance sources, docs and tests. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Two principles hold in every change:

1. **Trust stays visible.** Unverified reports must never look like official warnings.
2. **Never a false all-clear.** If the app can't check, it says so; it never shows "all quiet".

## Code of conduct

Everyone taking part in Moby follows the [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).

## Security

Found a vulnerability? Please don't open an issue; follow [SECURITY.md](SECURITY.md) to report it privately.

## License

Moby is free software, licensed under the [GNU General Public License v3.0](LICENSE). The on-device model is
downloaded separately under the NVIDIA Nemotron Open Model License.
