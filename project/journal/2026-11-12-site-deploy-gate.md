# site-deploy deploys only on site input changes

- Meta HOW-WE-BUILD WWW1. Kit syncs and lint config redeployed
  wildshard.io: the trigger took any `package.json` or workflow edit
  (opus-nonengine27 cancelled runs 43323519485 and 43324206972).
- `paths` now lets in `src/site/**` (minus tests, the README and the
  gate) and `package.json`; a `changes` job runs
  `src/site/tools/deploy-gate.ts` over before..after and keeps a
  `package.json` change only when a field the build reads moved
  (packageManager, engines, type, vite, pnpm overrides/patches,
  `site:deploy:cf`). `--no-renames`, so a file moved out of src/site/
  still counts. `workflow_dispatch` on main always deploys.
- The deploy job runs in the new `production` environment (branch
  policy: main only) and holds the `site-production` concurrency, so a
  no-op run never cancels a queued site change (claude -p review MUST).
- `CLOUDFLARE_API_TOKEN` is still a repo secret: its value can't be
  read back to copy it. Until Jake sets it on the environment and
  deletes the repo one, a branch's copy of the workflow could still
  read it from a job with no `environment:`.
