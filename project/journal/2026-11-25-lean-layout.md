# Moved to repo-kit's lean layout

Jake asked repo-kit's agent to move every repo to the lean layout
(repo-kit plan `opus-2026-11-25-shard-lean-layout`, R1). This repo
went second, after shard-showcase.

What moved:
- **Kit:** its scripts are in `src/scripts/.kit/` and its tests in
  `src/test/.kit/`. This repo's own scripts (prune-deployments,
  vercel-prune-check) are in `src/scripts/`.
- **Configs:** `kit/` is gone. Lint is the root `.oxlintrc.author.json`,
  the kit's strict config plus our `src/site/**` ratchet. Format is the
  kit's root `.oxfmtrc.json`. Typecheck is the root strict
  `tsconfig.json` over `src/`, plus the web and site projects, which
  keep their own settings.
- **Web tsconfig:** it lists `exclude: []` because it extends the root,
  and otherwise it would inherit the root's exclude of `src/web` and
  check nothing.
- **Verbs** follow D33: `pnpm test` runs our tests, the kit's, the git
  hooks' and the agent hooks', so CI drops `test:hooks`. `fix`
  replaces `lint:fix`.
- **Land is gone** (L7: www is main only). That removes
  `land.config.json`, land and worktree, and the disk lane's land tests
  that exercised them.
- **Agent hooks:** they come from repo-kit again. hc replaced the herdr
  guard.

The move's first commit skipped hooks (`--no-verify`, J381), because
its verbs still named `kit/` until this one. The push gate checks both.

The agent rules follow: `AGENTS.md` takes the kit's main-only block, and
its landing section shrinks to the one deploy note that still applies.
