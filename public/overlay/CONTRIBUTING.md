# Contributing to Moby

Thanks for helping! Contributions to every part of this repository are welcome: screens, the mesh,
offline features, translations, accessibility, docs and tests. Moby warns people about natural hazards,
so correctness and clarity matter more than speed. Small, focused pull requests are easiest to review.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

1. Fork and clone the repository, then `npm ci`.
2. Run the app in a browser (`EXPO_PUBLIC_USE_MOCK=true npx expo start --web`) or on an Android emulator
   (`npx expo run:android`, JDK 17). With no server configured it uses built-in sample data
   (`src/api/fixtures.ts`).
3. Make your change on a branch, and keep commits focused.

## Before you open a pull request

- `npm run typecheck`, `npm run lint` and `npm run check:types-generated` pass (CI runs them).
- The unit tests pass: `npm run test:lib`, `test:mesh`, `test:guidance`, `test:ondevice`.
- API changes: edit `api-contract-v1.yaml`, run `npm run generate-types`, update `src/api/fixtures.ts`,
  and describe the change; the maintainer implements it on the service side.
- New screens and components follow the existing patterns in `src/` and the theme tokens in
  `src/theme/`.
- Anything a person in danger might read (alert text, safety guidance, emergency numbers) cites an
  official source. Don't write safety advice from memory.
- Accessibility: tap targets of at least 48 dp, screen-reader labels, and enough contrast.

## Principles (please don't break these)

1. **Trust stays visible.** Unverified reports must never look like official warnings.
2. **Never a false all-clear.** If the app can't check, it says so.
3. **Critical alerts always get through.** No setting may hide a critical alert near the user.
4. **Translations are labelled.** Machine translation is marked as such, with the original one tap away.

## Reporting issues

Use the [issue templates](https://github.com/Xlient/Moby/issues/new/choose): bugs, features, and official
sources for new countries. For security problems, see [SECURITY.md](SECURITY.md).

By contributing you agree that your contributions are licensed under the GPL-3.0 (see
[LICENSE](LICENSE)), and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
