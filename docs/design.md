# www.wildshard.io: design

Status: draft 2026-11-05: the site is imported; the scaffold beside it is unused so far.

Living doc: **how** this repo is built. What it does and why is
`docs/prd.md`. Keep this true as the code changes.

## Today

The marketing site lives in `src/site/`. It is a static Vite build of
six pages: Jake's words from `COPY.md`, the game's numbers and grid from
`facts.json`, and media URLs from `media.json`. `tools/deploy.sh` builds
a clean export of HEAD and uploads it to the Cloudflare Worker
`wildshard-www` (`wrangler.jsonc`: static assets plus `worker.ts`),
which owns `wildshard.io` and `www` as custom domains. The Worker
308s www to the apex and serves the mp4s from R2 at `/media/v/`. It
left Vercel on 2026-11-11 (meta WWW-CLOUDFLARE-PLAN, J271). The
waitlist form posts to `api.wildshard.io/api/waitlist`.

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

- `@wildshard/format` is the npm alias
  `npm:@wildshard/shard-format@0.4.5`, dev only: `pnpm site:facts`
  and its test read it; the site build reads the committed facts.
  This pin keeps the site's 25-cell catalogue and format 0.1 excerpt.
- Shard authors install the SDK with `npm install @wildshard/sdk`.
  `docs/dev.md` records the temporary pnpm fallback until NP7 ships.

## Boundaries the checks enforce

- Builds without reading any other repo's files (W1)
