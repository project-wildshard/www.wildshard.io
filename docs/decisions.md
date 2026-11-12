# www.wildshard.io: decisions

Living doc. Decisions that bind this repo, newest last. Cross-repo decisions
(J-numbers) are Jake's, from `Raynos/project-wildshard-meta` `docs/multi-repo/MULTI-REPO-PLAN.md`;
this repo's own decisions are D-numbers.

## Cross-repo (J)

- **J6**: `api-server`: shard upload and download for authors, `sharddev` and the server. A thin wrapper around Cloudflare R2 for now. It also gets all the Vercel functions (`api/`)
- **J11**: Repos depend on each other through git dependencies pinned by tag; there is no registry

## This repo (D)

- **D25**: 2026-11-04: a commit of 30+ changed lines stages a
  `project/journal/` entry (from greenroom; `.githooks/pre-commit`).
- **D27**: 2026-11-04: main only: no branches, no worktrees, every
  agent commits on `main` by pathspec (from greenroom). Relaxed
  2026-11-12 by meta J240 and J290: a whole or half plan may work in
  `.worktrees/<slug>` on `plan/<slug>` and land through `land`
  (AGENTS.md); everything else stays on `main`.
- **D28**: 2026-11-05: lint is the strictest of greenroom and
  wildshard-singleplayer (every oxlint category denied, type-aware, warnings
  denied, unused disable directives are errors, `import/no-nodejs-modules`
  outside Node-side folders). Imported code may arrive under a shrink-only
  ratchet (Jake, 2026-11-05).
- **D29**: 2026-11-05: `src/site/facts.json` is committed and refreshed by
  hand at a game release (`docs/dev.md`). Nothing pushes it from the game
  yet: the simplest thing that works, chosen for the move out of
  singleplayer. Its recipe is replaced by D30.
- **D30**: 2026-11-05: `facts.json` no longer needs a game checkout.
  `pnpm site:facts` writes what `@wildshard/format` knows, a dev
  dependency the build never reads. The grid's cells, the road and the
  template excerpt stay by hand. `grid.cells` is the waitlist's one
  source: api-server keeps a copy and CI compares the two, because
  api-server depends on `shardfile` alone. The catalogue takes the grid
  over later (J61).
