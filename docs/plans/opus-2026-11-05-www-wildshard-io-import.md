# www.wildshard.io: import from singleplayer

Status: in progress 2026-11-05: imported from `3bd238492b`; `site-deploy.yml` waits on the `VERCEL_BUILD_TOKEN` secret.

One-page runbook for bringing this repo's code over from
`Raynos/project-wildshard-singleplayer`. The why and the full plan live in `Raynos/project-wildshard-meta`:
`docs/multi-repo/MULTI-REPO-PLAN.md`, `P1-IN-TREE.md`, `MOVES.md` (phase P2).
Live cross-repo status: `docs/multi-repo/STATE.md` there.

## What comes in

From `Raynos/project-wildshard-singleplayer@3bd238492bcdc582d9fb09598540ad42b4a7488b`:

- `site/`
- `.github/workflows/site-deploy.yml`
- the Vercel project `wildshard-site` and its token

## Left to do

`site-deploy` stops at its first check until the repo has
`VERCEL_BUILD_TOKEN`. There is no way round a new token:

- singleplayer's value cannot be read back, and the CLI login cannot
  mint one (403, "Cannot create tokens for this app");
- a Git link would need no token, but Vercel's GitHub App is not
  installed on `project-wildshard` (only `project-wildshard-ci` is), and
  installing it is a bigger ask than a token;
- the CLI login is Jake's own and stays out of repo secrets.

So Jake makes one at <https://vercel.com/account/settings/tokens>, scope
`raynos-projects`, name `www-site-deploy`, copies it, and runs:

```sh
pbpaste | gh secret set VERCEL_BUILD_TOKEN -R project-wildshard/www.wildshard.io
gh workflow run site-deploy -R project-wildshard/www.wildshard.io
```

The rest of the job is checked: it installs, and `tools/deploy.sh
--build-only` builds `e4ec745`. Until then `pnpm site:deploy` ships by
hand on the CLI login.

## Before the import

- W1
- F1

## Steps (MOVES.md, the standard move)

| # | Step | Done when |
|---|---|---|
| 1 | Freeze: tell the singleplayer lanes, pause commits to the moving paths, record the SHA | The SHA is in this plan |
| 2 | Import commit: copy the paths at that SHA into this repo; the message names the SHA and paths (J12) | One commit, nothing else in it |
| 3 | Binaries over 1 MB go to R2 by hash (J13) | The pre-commit size cap passes without `ALLOW_BIG` |
| 4 | Green: `pnpm check` and CI pass; imported code that fails the strict lint goes under a shrink-only ratchet (D28) | CI green on `main` |
| 5 | Release (not a dependency of other repos: skip) | The tag installs as a git dependency |
| 6 | Switch: singleplayer uses this repo (git dependency or deploy) instead of its own copy | Singleplayer CI green |
| 7 | Delete the paths from singleplayer in one commit naming this repo and tag | Gone from singleplayer |
| 8 | Unfreeze; record the move in the meta repo's `STATE.md`; set this plan to finished | STATE.md says moved |

Rollback: until step 7 singleplayer still has everything, so drop the import commit.
