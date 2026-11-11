// Fails when a workflow deploys to Vercel and never prunes. Singleplayer's J189 rewrite (448ef9a, 2026-11-07) dropped
// its prune step without a red anywhere, and Deployment Storage went from 23 GB to 93 GB in three days (meta
// VERCEL-SPEND-PLAN). Shared from repo-kit; every repo that deploys to Vercel runs it in `pnpm check`.
//
//   node scripts/vercel-prune-check.mjs [repo-root]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A workflow deploys to Vercel when it runs or installs the Vercel CLI. */
const DEPLOYS = /\bvercel(?:_cli)?\s+deploy\b|install\s+(?:--global|-g)\s+vercel\b|\bvercel@\d/;
/** It prunes when a step runs the shared script that is not switched off. */
const PRUNES = /^\s*(?:-\s+)?(?:run:\s*)?node\s+scripts\/prune-deployments\.mjs\b/m;

/** @param {string} text @returns {'none'|'ok'|'missing'} */
export function verdict(text) {
  const lines = text.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  if (!DEPLOYS.test(lines)) return 'none';
  return PRUNES.test(lines) ? 'ok' : 'missing';
}

/** @param {string} root @returns {{file: string, verdict: string}[]} */
export function check(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort()
    .map((name) => ({ file: `.github/workflows/${name}`, verdict: verdict(readFileSync(join(dir, name), 'utf8')) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(process.argv[2] ?? '.');
  const rows = check(root).filter((row) => row.verdict !== 'none');
  const missing = rows.filter((row) => row.verdict === 'missing');
  for (const row of missing) {
    console.error(`${row.file} deploys to Vercel and never runs node scripts/prune-deployments.mjs (meta VERCEL-SPEND-PLAN)`);
  }
  if (missing.length > 0 || (rows.length > 0 && !existsSync(join(root, 'scripts', 'prune-deployments.mjs')))) {
    if (missing.length === 0) console.error('scripts/prune-deployments.mjs is missing; copy it from repo-kit');
    process.exitCode = 1;
  } else {
    console.log(`Vercel prune check: ${rows.length} deploying workflow(s), all prune`);
  }
}
