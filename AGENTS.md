# AGENTS.md

> Human-written section (Jake). Empty until Jake writes it; until then the agent section below holds the working rules.

<!-- agents-below: everything under this line is agent-written (Claude, Codex); agents never edit above it (J241) -->

## Agent-written

> Written by: Claude and Codex (agents). Jake gardens this; it may be purged or promoted above the line.

 - AGENTS.md: agents edit only below the J241 marker, never above it; README.md stays humans-only unless Jake says otherwise
 - Every request for work from Jake -> src/scripts/ask-new.sh "<his words>", rules in docs/tasks/asks/README.md
 - Follow-up work is a row in a live plan, never a new ask.

Git hygiene

 - Small Commit early & often.
 - Two ways to work, no in-between (J290). The lane's brief names the mode; a unit with no mode named is mode 1 if it
   is one row or one fix.
   1. **Small or urgent unit** (one row, one fix): work and commit straight on `main` in the canonical checkout
      (`~/projects/games/wildshard/www.wildshard.io`), by pathspec. Then `git pull --rebase origin main` and a plain
      `git push origin main` through the normal pre-push. No worktree, no land.
   2. **A whole plan or half a plan:** its own worktree, `node scripts/worktree.mjs new <slug>` (`.worktrees/<slug>`
      on `plan/<slug>`). Commit there by pathspec. Never push `plan/<slug>` by hand: only `land` pushes it (a hand
      push spends a CI run and can cancel the one land waits on). Land with `WS_LANE_NAME=<lane> node scripts/land.mjs`
      from the worktree only when the plan is complete, at a major milestone, or once a day for a multi-day plan.
      Never land per row. `node scripts/worktree.mjs reap` removes worktrees whose branch has landed.
 - Never hand-push a plan branch to main, never `--no-verify` or `SKIP_*`, never force main; only `land`
   force-pushes your `plan/*` branch, under its own lease. No other branches or worktrees.
 - Use pre-commit & pre-push git hooks for keeping checks/quality/lints etc.
 - Mode 1: push after every commit. Mode 2: commit often; `land` does the pushing.
 - Every meaningful commit writes a journal into project/journal, the why & informal.

Landing from a worktree (mode 2; `scripts/land.mjs`, settings in `land.config.json`)

 - Land rebases onto main if it is ahead, pushes `plan/<slug>`, waits for that exact SHA's `ci` push run
   to go green, rebases again if main moved (a conflict stops; a clean rebase carries the green run), pushes main
   fast-forward only (never forced), then deletes the plan branch and the worktree. One land per worktree; worktrees never wait on each other.
 - After a rebase that moves `pnpm-lock.yaml` or a `package.json`, land runs `pnpm install --frozen-lockfile --config.confirmModulesPurge=false`.
 - Landings, CI reds, refusals and give-ups append a line to `~/.cache/wildshard/lane-receipts.log` (`grep ' land '`).
 - Main's CI runs after every land; if it goes red, the lane that landed last fixes it forward or reverts it, at once.
 - A plan branch never deploys: `ci` only checks, and `site-deploy` runs on `main` only (its job skips any other ref).
   A landing that touches `src/site/`, `package.json` or the lockfile redeploys wildshard.io from main, like any push.

Shared checkout

 - Many agents work here, git add only for new files, use git commit -- <filespec>
 - Never git add -A / . / -u, never git commit -a, never bare git commit.
 - Never stash, checkout, restore or delete what you didn't author.

Githooks

 - pnpm install will install the hooks.

Docs / Repo shape

 - docs/ is living: edit in place, keep it true. See docs/plans for all the plans.
 - project/ is for history. See project/archive for the archives.
 - Code in ./src/ etc.
 - Top level directory is thin & lean.
 - Dev commands, layout, code rules in docs/dev.md
 - Scratch goes in ./tmp/<task>; delete it when done.

Code rules

 - In the test suite, No LLM, no claude, no herdr.
 - Every Chromium launch passes `--use-mock-keychain` and `--password-store=basic` (else a macOS keychain dialog opens).

Agent tooling

 - Claude Code and Codex load the same tooling from one source (meta MULTI-AGENT-TOOLING): skills in `.agents/skills/`, hook scripts in `.agents/hooks/`, hooks declared once in `.agents/hooks.json` (this repo's own in `.agents/hooks.local.json`). `pnpm agents:sync` writes the rest; never edit `.claude/settings.json` hooks, `.codex/hooks.json` or `.claude/skills` by hand. repo-kit stamps it: `node ../repo-kit/scripts/agent-sync.mjs --from ../repo-kit`.
