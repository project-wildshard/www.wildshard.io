# 2026-11-10 AGENTS.md check (J241)

- Copied the AGENTS.md check from repo-kit `df784f0` (REPO-KIT row
  K10): `.githooks/agents-md.mjs`, its test, the new `commit-msg`
  and `pre-push`, and `docs/agents-md.md`. `pnpm check` now runs
  `check:agents`.
- The lint keeps AGENTS.md's marker and `## Agent-written` shape and
  CLAUDE.md as `@AGENTS.md`. The guard refuses an AI commit
  (`Assisted-by:`) that changes a line above the marker; Jake's
  human commits may change anything.
- A per-repo copy ahead of the kit move: K1/K7's sync takes ownership
  of these files later.
