# www.wildshard.io: design

Status: draft 2026-11-05: scaffold only; the real design arrives with the import.

Living doc: **how** this repo is built. What it does and why is
`docs/prd.md`. Keep this true as the code changes.

## Today

Only the scaffold exists:

- `src/cli/`: the CLI (`--version`, `--help`; commands arrive with the import).
- `src/test/helpers/`: shared test helpers; `git.ts` makes real git repos in temp dirs.
- `src/server/`: the Hono app (`GET /api/health`) and `serve.ts`.
- `src/shared/`: zod schemas used on both sides of the wire.
- `src/web/`: the Preact web app, with its own `tsconfig.json` (DOM lib).
- `src/tools/build-web.ts`: esbuild into `src/dist/web` (`--dev` watches and serves).
- `src/e2e/`: Playwright smoke test (CI).
- `src/scripts/`: repo tooling (asks, md-wrap), plain JS.

## Dependencies

- `shardfile`, by git tag (`github:project-wildshard/<repo>#vX.Y.Z`)

## Boundaries the checks enforce

- Builds without reading any other repo's files (W1)

## Coming with the import

- `site/`
- `.github/workflows/site-deploy.yml`
- the Vercel project `wildshard-site` and its token
- `site/tools/facts.ts` today reads four game files; W1 replaces them with published facts.
