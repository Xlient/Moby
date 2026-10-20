# Contributing to Moby

Thanks for helping! Contributions to every part of Moby are welcome: the app, the backend, official feeds
for new countries, translations, safety guidance sources, evaluations, docs and tests. Moby warns people
about natural hazards, so correctness and clarity matter more than speed. Small, focused pull requests are
easiest to review.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** or **suggest a feature** with the [issue templates](https://github.com/Xlient/Moby/issues/new/choose).
- **Add an official source** for a country Moby doesn't cover yet: a national weather or geological service,
  or a Common Alerting Protocol feed. Use the *Official source* issue template, or send a feed module under
  `moby/feeds/`.
- **Improve a translation** or the plain-language wording of the app.
- **Pick up an issue** labelled `good first issue` or `help wanted`. Comment first so two people don't work on the same thing.

Found a security problem? Don't open an issue: follow [SECURITY.md](SECURITY.md).

## Getting set up

The [README](README.md#run-from-source) has the full instructions. In short:

- **App only:** `npm ci`, then `EXPO_PUBLIC_USE_MOCK=true npx expo start --web`, or `npx expo run:android`
  (JDK 17). With no API address the app runs on built-in sample data (`src/api/fixtures.ts`), so you can
  change every screen without a backend.
- **Backend:** `cp .env.example .env`, `docker compose up -d --build`, `uv sync`, then run the API with
  `MOBY_AUTH_DISABLED=true uv run --env-file .env uvicorn moby.api.app:app --port 8000`. Model keys are optional;
  without them the AI features fall back to the official text.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Keep each pull request to one change, and say why in the description.
3. Changing the API? Edit [`api-contract-v1.yaml`](api-contract-v1.yaml) first, run `npm run generate-types`,
   update the sample data in `src/api/fixtures.ts`, then the server.
4. Database changes are new numbered migrations in `db/migrations/`; never edit one that has shipped.
5. Add or update tests for what you changed.

## Before you open a pull request

CI runs these on every pull request; please run them first.

**App**

```bash
npm run typecheck
npm run lint
npm run check:types-generated
npm run test:lib && npm run test:mesh && npm run test:guidance && npm run test:ondevice
```

**Backend** (needs the Docker database)

```bash
uv run ruff check moby scripts tests main.py
uv run --env-file .env pytest -q
```

Evaluations that call paid models (`model-evals` workflow) run only when the maintainer approves them;
you don't need a model key to contribute.

## Guidelines

- New screens and components follow the patterns in `src/` and the theme tokens in `src/theme/`.
- Anything a person in danger might read (alert text, safety guidance, emergency numbers) cites an official
  source. Don't write safety advice from memory.
- Model output always passes a check before anyone sees it, and has a fallback to the official text.
  Models never decide whether something is confirmed or how urgent it is.
- Accessibility: tap targets of at least 48 dp, screen-reader labels, and enough contrast in light and dark themes.
- Privacy: collect nothing new without a reason, and never send personal details to a third party.
- Write plainly. Short sentences, no jargon, in the app and in the docs.

## Principles (please don't break these)

1. **Trust stays visible.** Unverified reports must never look like official warnings.
2. **Never a false all-clear.** If the app can't check, it says so.
3. **Critical alerts always get through.** No setting may hide a critical alert near the user.
4. **Translations are labelled.** Machine translation is marked as such, with the original one tap away.

## Review

Every pull request is reviewed by the maintainer ([CODEOWNERS](.github/CODEOWNERS)). Expect a first response
within a week. Changes to safety-critical paths (alert tiers, notifications, grounding checks) get a closer look.

## License

By contributing you agree that your contributions are licensed under the GNU General Public License v3.0
(see [LICENSE](LICENSE)).
