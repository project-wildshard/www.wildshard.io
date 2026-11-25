# AGENTS.md

> Human-written section (Jake). Empty until Jake writes it; until then the agent section below holds the working rules.

<!-- agents-below: everything under this line is agent-written (Claude, Codex); agents never edit above it (J241) -->

## Agent-written

> Written by: Claude and Codex (agents). Jake gardens this; it may be purged or promoted above the line.

 - AGENTS.md: agents edit only below the J241 marker, never above it; README.md stays humans-only unless Jake says otherwise
 - Every request for work from Jake -> src/scripts/.kit/ask-new.sh "<his words>", rules in docs/tasks/asks/README.md
 - Follow-up work is a row in a live plan, never a new ask.

Git hygiene

 - Small Commit early & often.
 - Main only (D36: this repo has no `land.config.json`): many agents share one checkout
   (`~/projects/games/wildshard/www.wildshard.io`) and every commit goes straight on `main`. No worktrees,
   no branches, no landing. After each commit, `git pull --rebase origin main`, then a plain
   `git push origin main` through the normal pre-push (it runs `pnpm check` in a clean copy).
 - Never `--no-verify` or `SKIP_*`, never force main.
 - If main's CI goes red, whoever pushed last fixes it forward or reverts it, at once.
 - Every meaningful commit writes a journal into project/journal, the why & informal.

Deploys

 - `site-deploy` runs on `main` only: a push that touches `src/site/`, `package.json` or the lockfile
   redeploys wildshard.io from main.

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
