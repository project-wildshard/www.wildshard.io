# www.wildshard.io: design

Status: draft 2026-11-05: the site is imported; the scaffold beside it is unused so far.

Living doc: **how** this repo is built. What it does and why is
`docs/prd.md`. Keep this true as the code changes.

## Today

The marketing site lives in `src/site/`. It is a static Vite build of
six pages: Jake's words from `COPY.md`, the game's numbers and grid from
`facts.json`, and media URLs from `media.json`. `tools/deploy.sh` builds
a clean export of HEAD and uploads the output to the Vercel project
`wildshard-site`, which has no Git link and owns the domains. The
waitlist form posts to `wildshard-singleplayer.vercel.app/api/waitlist`.

The repo-kit scaffold sits beside it:

- `src/cli/`: the CLI (`--version`, `--help`; commands arrive with the import).
- `src/test/helpers/`: shared test helpers; `git.ts` makes real git repos in temp dirs.
- `src/server/`: the Hono app (`GET /api/health`) and `serve.ts`.
- `src/shared/`: zod schemas used on both sides of the wire.
- `src/web/`: the Preact web app, with its own `tsconfig.json` (DOM lib).
- `src/tools/build-web.ts`: esbuild into `src/dist/web` (`--dev` watches and serves).
- `src/e2e/`: Playwright smoke test (CI).
- `src/scripts/`: repo tooling (asks, md-wrap), plain JS.

## Dependencies

- `@wildshard/format` by git tag
  (`github:project-wildshard/shardfile#v0.3.1`), dev only: `pnpm
  site:facts` and its test read it, and the site's build doesn't. The
  install still fetches it, so `site-deploy` needs the org app token.

## Boundaries the checks enforce

- Builds without reading any other repo's files (W1)
