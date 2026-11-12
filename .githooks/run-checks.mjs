// The code-quality lanes, keyed off package.json scripts so they switch
// on by themselves once the scaffold defines them.
//   commit: like the scaffold's own pre-commit: `lint` and `format:check`
//           on the staged code files only, plus the whole `typecheck`,
//           in parallel under a budget (silent < 5 s, warn 5-8 s, BLOCK
//           > 8 s; SKIP_BUDGET=1). Skipped when no code or JSON is staged.
//   push:   the full `check` script (adds knip and the unit tests).
//   both:   .githooks/pinned-links.mjs first (commit warns, push refuses;
//           SKIP_CHECK does not skip it).
// The hooks only check; `pnpm lint:fix` / `pnpm format` fix.
// Bypass a lane: SKIP_CHECK=1 (last resort; CI still runs it).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './lib.mjs';
import { guardPinnedLinks } from './pinned-links.mjs';

const lane = process.argv[2];
const root = git(['rev-parse', '--show-toplevel']).trim();
const SOFT = Number(process.env.PRECOMMIT_SOFT_S ?? 5);
const HARD = Number(process.env.PRECOMMIT_HARD_S ?? 8);
const LINTABLE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const FORMATTABLE = /\.(?:ts|tsx|js|mjs|cjs|json|jsonc)$/;

// A push that only deletes plan/* branches (`git push --delete origin plan/<slug>`
// after a landing, J240) sends no commit, so there is nothing to check. Any
// other deleted ref, or any update pushed alongside, keeps the gate.
if (lane === 'push') {
  const lines = (process.env.WS_PUSH_REFS ?? '').split('\n').map((line) => line.trim().split(/\s+/u)).filter((row) => row[0] !== '');
  if (lines.length > 0 && lines.every(([, local = '', remote = '']) => /^0+$/u.test(local) && /^refs\/heads\/plan\/[a-z0-9][a-z0-9._-]*$/u.test(remote))) {
    console.error(`  - delete-only push of ${lines.map(([, , remote]) => remote).join(', ')}: no commit leaves this machine; push lane skipped`);
    process.exit(0);
  }
}
// Pinned links: a node_modules/@wildshard/* alias on a live checkout tests
// another lane's edits, not the pin CI uses. Commit warns, push refuses.
// It runs before SKIP_CHECK: a lane that links on purpose writes a receipt.
if (!guardPinnedLinks(root, lane)) process.exit(1);
if (process.env.SKIP_CHECK === '1') {
  console.error(`  - SKIP_CHECK=1: ${lane} lane skipped (CI still runs it)`);
  process.exit(0);
}
// The package is at the repo root; its configs live in src/.
const pkgDir = root;
const pkgPath = join(pkgDir, 'package.json');
const scripts = existsSync(pkgPath) ? (JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}) : {};

/** @type {{ name: string, args: string[] }[]} */
const jobs = [];
if (lane === 'commit') {
  // Staged code under src/, passed relative to the repo root (the
  // package root). Code outside src/ (.githooks, docs) has its own checks.
  const staged = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).split('\0').filter(Boolean)
    .filter((path) => path.startsWith('src/'));
  const lint = staged.filter((path) => LINTABLE.test(path));
  const format = staged.filter((path) => FORMATTABLE.test(path));
  if (scripts.lint && lint.length) jobs.push({ name: 'lint', args: ['lint', ...lint] });
  if (scripts['format:check'] && format.length) {
    jobs.push({ name: 'format:check', args: ['format:check', '--no-error-on-unmatched-pattern', ...format] });
  }
  if (scripts.typecheck && format.length) jobs.push({ name: 'typecheck', args: ['typecheck'] });
  if (!jobs.length) {
    if (Object.keys(scripts).length) console.error('  - no code staged: commit lane skipped');
    process.exit(0);
  }
} else if (scripts.check) {
  jobs.push({ name: 'check', args: ['check'] });
}
if (!jobs.length) process.exit(0); // no toolchain yet

if (!existsSync(join(pkgDir, 'node_modules'))) {
  console.error(`\n  X ${lane} blocked: node_modules is missing. Run pnpm install (or SKIP_CHECK=1).\n`);
  process.exit(1);
}

// Hooks export GIT_INDEX_FILE and friends; tools that shell out to git
// (knip, tests that build repos) must see a normal environment.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const run = ({ name, args }) => new Promise((done) => {
  const child = spawn('pnpm', ['run', '--silent', ...args], { cwd: pkgDir, env });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  child.on('close', (code) => done({ name, code, output }));
});

console.error(`  - ${lane} lane: pnpm ${jobs.map((job) => job.name).join(', ')}`);
const started = Date.now();
const results = await Promise.all(jobs.map(run));
const seconds = (Date.now() - started) / 1000;

const failed = results.filter((result) => result.code !== 0);
for (const { name, output } of failed) console.error(`\n  X pnpm ${name} failed:\n${output.trim().replace(/^/gm, '    ')}`);
if (failed.length) {
  const fix = lane === 'commit' ? ' (pnpm lint:fix / pnpm format fix most of it)' : '';
  console.error(`\n  ${lane} blocked. Fix it${fix}; SKIP_CHECK=1 is a last resort.\n`);
  process.exit(1);
}

if (lane === 'commit') {
  if (seconds > HARD && process.env.SKIP_BUDGET !== '1') {
    console.error(`\n  X commit blocked: the commit lane took ${seconds.toFixed(1)} s, over the ${HARD} s budget.`);
    console.error('    Something slow crept in; move it to the push lane. Loaded machine? SKIP_BUDGET=1.\n');
    process.exit(1);
  }
  if (seconds > SOFT) console.error(`  !! commit lane took ${seconds.toFixed(1)} s (soft ${SOFT} s, hard ${HARD} s)`);
}
console.error(`  - ${lane} lane green in ${seconds.toFixed(1)} s`);
