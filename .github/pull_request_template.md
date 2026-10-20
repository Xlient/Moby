## What and why

<!-- What does this change, and why? Link the issue it fixes: "Fixes #123". -->

## How I tested it

<!-- Commands you ran, devices or emulators you tried, screenshots for UI changes. -->

## Checklist

- [ ] `npm run typecheck` and `npm run lint` pass (app changes)
- [ ] `uv run ruff check moby scripts tests main.py` and `uv run pytest` pass (backend changes)
- [ ] API changes: `api-contract-v1.yaml` updated and `npm run generate-types` run
- [ ] Tests added or updated
- [ ] Unverified reports still never look like official warnings, and nothing shows a false all-clear
- [ ] Anything people in danger might read cites an official source
- [ ] New controls have screen-reader labels and 48 dp tap targets
- [ ] No secrets, keys, personal data or production URLs in the diff

By opening this pull request I agree to license my contribution under the GPL-3.0 and to follow the
[Code of Conduct](../CODE_OF_CONDUCT.md).
