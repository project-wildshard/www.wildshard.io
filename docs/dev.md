# Developing www.wildshard.io

Living doc: commands, layout, code rules and git hooks. AGENTS.md
links here.

## Commands

Run from the repo root.

- `pnpm install`: installs deps and points `core.hooksPath` at
  `.githooks/`.
- `pnpm check`: the repo's checks. The pre-push hook runs it.
- `pnpm test:hooks`: the `.githooks/` suite (CI, and pre-commit when
  hooks change).
- `pnpm md:wrap`: rewraps Markdown prose.
- `src/scripts/ask-new.sh "<Jake's words>"`: opens an ask
  (`docs/tasks/asks/README.md`).

## Layout

The root stays thin: README.md and AGENTS.md (humans only),
CLAUDE.md (`@AGENTS.md`), package.json, pnpm-lock.yaml, .npmrc,
.gitignore, .editorconfig, `docs/`, `project/`, `src/` and the dot
dirs. Scratch goes in `tmp/<task>/` and is deleted when done.

- `src/`: code, including `src/scripts/` (asks, md-wrap).
- `docs/`: living docs; `docs/plans/` is the queue,
  `docs/tasks/asks/` the receipts.
- `project/`: history; `project/journal/`, `project/archive/`.

## Git hooks

Enabled by `pnpm install` (`git config core.hooksPath .githooks`).

- **pre-commit**: main only, no worktrees (`ALLOW_BRANCH=1`); 1 MB
  blob cap (`ALLOW_BIG=1`; large binaries go to R2); credential scan
  (`ALLOW_SECRET=1`); new plans need a `Status:` line; 30+ changed
  lines need a `project/journal/` entry (`SKIP_JOURNAL=1`); the code
  lane (`SKIP_CHECK=1`).
- **commit-msg**: Conventional Commits, subject ≤ 50, body wrapped at
  72, one `Assisted-by: AGENT:MODEL` trailer for AI commits
  (`SKIP_ATTRIB=1` for human-only commits), no `Co-Authored-By` for
  AI and no robot banners.
- **pre-push**: re-runs the blob checks on every outgoing commit, then
  `pnpm check`.

## Dependencies on other Wildshard repos

Git dependencies pinned by tag, never a branch:
`github:project-wildshard/<repo>#vX.Y.Z`. Releases commit built `dist/`
on a tag-only commit. The org's repos are private, so CI reads them with
an org GitHub App token.
