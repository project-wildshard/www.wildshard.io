# Developing www.wildshard.io

Living doc: commands, layout, code rules and git hooks. AGENTS.md links
here; what the repo does is `docs/prd.md`, how it is built `docs/design.md`.

## Commands

Run from the repo root.

- `pnpm install`: installs deps and points `core.hooksPath` at `.githooks/`.
- `pnpm check`: typecheck + lint + format:check + unit tests + asks. The pre-push hook runs it.
- `pnpm test`: `node:test` on `src/**/*.test.ts`, run as .ts by Node's type stripping.
- `pnpm test:hooks`: the `.githooks/` suite (CI, and pre-commit when hooks change).
- `pnpm dev`: esbuild watch + the server on http://127.0.0.1:4404.
- `pnpm build`: builds the web app into `src/dist/web`.
- `pnpm site:build`: builds the marketing site into `src/site/dist`.
- `pnpm site:deploy`: ships HEAD to the Cloudflare Worker
  `wildshard-www` on your wrangler login. `pnpm site:deploy:cf`
  uploads an existing `src/site/dist` as it is. A push that changes
  `src/site/` does the same through `site-deploy.yml` once the repo
  has a `CLOUDFLARE_API_TOKEN` secret; without it the step warns.
- `pnpm site:facts`: rewrites what `src/site/facts.json` takes from
  `@wildshard/format` (see "Refreshing the site's facts").
- `pnpm site:media <folder>`: publishes the trailer and shard loops to
  R2 `wildshard-records` (`site/media/`, via wrangler) and rewrites
  `src/site/media.json`.
- `pnpm test:e2e`: Playwright against a built app. CI only.
- `pnpm lint:fix` / `pnpm format`: the hooks only check; these fix.
- `node src/cli/main.ts --help`: the CLI without installing it. `serve [--port n]` starts the server (default 4404).
- `pnpm md:wrap`: rewraps Markdown prose to ~72 columns.
- `kit/scripts/ask-new.sh "<Jake's words>"`: opens an ask (`docs/tasks/asks/README.md`).

## Layout

The root stays thin: README.md and AGENTS.md (humans only), CLAUDE.md
(`@AGENTS.md`), package.json, pnpm-lock.yaml, .npmrc, .gitignore,
.editorconfig, `docs/`, `project/`, `src/` and the dot dirs. Scratch
goes in `tmp/<task>/` and is deleted when done.

- `src/cli/`: the CLI (`--version`, `--help`; commands arrive with the import).
- `kit/test/helpers/`: shared test helpers; `git.ts` makes real git repos in temp dirs.
- `src/server/`: the Hono app (`GET /api/health`) and `serve.ts`.
- `src/shared/`: zod schemas used on both sides of the wire.
- `src/web/`: the Preact web app, with its own `tsconfig.json` (DOM lib).
- `src/site/`: the marketing site, a Vite build with its own `tsconfig.json`. Jake's words are in `COPY.md`.
- `src/tools/build-web.ts`: esbuild into `src/dist/web` (`--dev` watches and serves).
- `src/e2e/`: Playwright smoke test (CI).
- `src/scripts/`: repo tooling (asks, md-wrap), plain JS.
- `docs/`: living docs. `docs/plans/` is the queue, `docs/tasks/asks/`
  the receipts.
- `project/`: history. `journal/`, `origins/` (the meta-repo plans this
  repo came from), `archive/`.

## Code rules

- TypeScript only, imports with explicit `.ts`/`.tsx` extensions.
- Every function has an explicit return type. `kit/.oxlintrc.json` denies
  every category (D28); disable a rule only with a one-line reason beside it.
- Pin dependencies exactly (`.npmrc` has `save-exact=true`).
- Public Wildshard packages come from npm (meta J315). Use pnpm to
  update this repo's `package.json` and `pnpm-lock.yaml`.
- In a new author project, install with `npm install @wildshard/sdk`.
  Until NPM-PUBLISH NP7 removes the SDK's git dependencies, npm may
  refuse with `EUNSUPPORTEDPROTOCOL`; use `pnpm add @wildshard/sdk`
  and `pnpm exec wildshard` during that transition.
- Tests use real things (git in temp dirs, real files and processes); never
  mock git. No LLM, `claude`, herdr or network in tests.

## Refreshing the site's facts

`src/site/facts.json` is the one source for what the site says about
the game, and for the grid the waitlist form and `/build` draw. A
refresh needs no game checkout. The build reads only this file.

| Field | Source | How it changes |
| --- | --- | --- |
| `grid.cellSize`, `grid.pitch` | `@wildshard/format`: `CHUNK_SIZE`, `CONTENT_CAPS.pitch` | bump the pin, `pnpm site:facts` |
| `memory` | `@wildshard/format`: `MEMORY_GATES` | bump the pin, `pnpm site:facts` |
| `schemaPaths` | `@wildshard/format`: paths in `ShardfileSchema` | bump the pin, `pnpm site:facts` |
| `grid.cells` | **by hand**, until the catalogue is the real placement (J61) | edit it, then the steps below |
| `grid.road` | **by hand**: the engine's `ROAD_WIDTH`; the format has no road width (`ENTRY_ASPHALT` is a depth), and the engine has no tag | edit it |
| `shardfile` | **by hand**: an excerpt of the template's built `shard.json`, until `shard-templates` ships it | edit it |

`pnpm test` fails when `facts.json` falls behind the pinned format, and
`pnpm site:facts` stops when the grid's size or the excerpt's `version`
no longer fit the format. Nothing can see a wrong placement, road or
excerpt: those were last checked against singleplayer at `1e55422db9`,
by reading its source. Commit the result here; the push deploys it.

### Moving a shard on the grid

The form is drawn from `grid.cells`. api-server refuses claims from
its own copy, `src/server/routes/waitlist-grid.json`, so change both:

1. Edit `grid.cells` here and push. A new shard also needs its map label
   in `src/site/vite.config.ts` and `COPY.md`, or the build stops.
2. In api-server, run `pnpm site:grid ../www.wildshard.io/src/site/facts.json`
   and push.

CI in each repo compares with the other's `main` (`pnpm site:api-grid`
here, `pnpm site:grid --check` there), so one repo is red between the
two pushes. Tests can't reach another repo, so that gate is CI's. To run
it by hand: `pnpm site:api-grid ../api-server/src/server/routes/waitlist-grid.json`.

## Git hooks

| Hook | Checks | Bypass |
| --- | --- | --- |
| commit-msg | Conventional Commits subject ≤ 50, body ≤ 72, one `Assisted-by: AGENT:MODEL` trailer, no AI `Co-Authored-By` | `SKIP_ATTRIB=1` (human-only commit) |
| pre-commit | `main` in the main checkout (D27), staged set echo, whitespace, 1 MB cap, credentials, sh / mjs syntax, new-plan Status line, journal (D25) | `ALLOW_BRANCH=1`, `ALLOW_BIG=1`, `ALLOW_SECRET=1`, `SKIP_JOURNAL=1` |
| pre-commit | lint + format:check on staged code, typecheck; 8 s budget | `SKIP_BUDGET=1` (time only), `SKIP_CHECK=1` |
| pre-push | outgoing commits: size, credentials, syntax; then `pnpm check` | `ALLOW_BIG=1`, `ALLOW_SECRET=1`, `SKIP_CHECK=1` |

Bypasses are for the case they name, never for a red gate: fix the code,
not the gate.
