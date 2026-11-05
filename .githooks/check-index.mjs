// pre-commit: check what THIS commit will contain (the index git is
// about to write, including the private index of a pathspec commit).
//   0. HEAD is main in the main checkout (D27; ALLOW_BRANCH=1).
//   1. Print the staged set, so a file swept in from another agent's
//      work in this shared checkout is loud.
//   2. `git diff --cached --check`: whitespace errors, conflict markers.
//   3. Per staged blob: 1 MB cap, credential scan, bash / module syntax.
//   4. Journal: 30+ changed lines need a project/journal/*.md entry
//      staged (D25; SKIP_JOURNAL=1).
//   5. Staged ask files pass src/scripts/asks.mjs check.
//   6. Touching .githooks/, .claude/hooks/ or src/scripts/ runs the hook suite.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { blobSizes, checkBlob, git, herdrPeers, printPeers, report } from './lib.mjs';

// 0. Main only (D27): every agent commits on `main` in the main checkout.
//    No branches, no worktrees. A rebase onto main (detached HEAD) is
//    fine. Bypass: ALLOW_BRANCH=1.
if (process.env.ALLOW_BRANCH !== '1') {
  const branch = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const rebasing = ['rebase-merge', 'rebase-apply'].some((dir) => existsSync(git(['rev-parse', '--git-path', dir]).trim()));
  const linked = git(['rev-parse', '--absolute-git-dir']).trim() !== git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const problems = [
    ...(linked ? [`this is a linked worktree (${git(['rev-parse', '--show-toplevel']).trim()}); commit in the main checkout`] : []),
    ...(branch !== 'main' && !rebasing ? [`HEAD is ${branch ? `branch "${branch}"` : 'detached'}, not main`] : []),
  ];
  if (report('commit blocked: main only, no branches, no worktrees (D27)', problems.length ? [
    ...problems,
    'Commit straight on main in the shared checkout, by pathspec.',
    'Moving work off a branch: land it on main, then Jake deletes the branch.',
  ] : [])) process.exit(1);
}

const changed = git(['diff', '--cached', '--name-status', '-z']).split('\0').filter(Boolean);
const lines = [];
for (let i = 0; i < changed.length; i++) {
  const status = changed[i];
  const paths = status.startsWith('R') || status.startsWith('C') ? [changed[++i], changed[++i]] : [changed[++i]];
  lines.push(`      ${status[0]} ${paths.join(' -> ')}`);
}
console.error('  - staged for THIS commit:');
console.error(lines.length ? lines.join('\n') : '      (nothing)');
printPeers(herdrPeers(), 'live in this repo: stage only your own paths');

const whitespace = spawnSync('git', ['diff', '--cached', '--check'], { encoding: 'utf8' });
if (whitespace.status !== 0) {
  report('commit blocked: whitespace errors or conflict markers', [(whitespace.stdout + whitespace.stderr).trim()]);
  process.exit(1);
}

const files = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).split('\0').filter(Boolean);
const wanted = new Set(files);
const entries = git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean).flatMap((record) => {
  const tab = record.indexOf('\t');
  const path = record.slice(tab + 1);
  if (!wanted.has(path)) return [];
  const [mode, object] = record.slice(0, tab).split(' ');
  return [{ path, object, mode }];
});
const sizes = blobSizes(entries.map((entry) => entry.object));
const problems = entries.flatMap((entry) => checkBlob(entry, sizes.get(entry.object) ?? 0));
if (report('commit blocked', problems)) process.exit(1);

// Ask files (docs/tasks/asks/) follow src/scripts/asks.mjs's rules. It reads
// the staged blobs through the inherited GIT_INDEX_FILE.
const asksTool = 'src/scripts/asks.mjs';
if (files.some((path) => /^docs\/tasks\/asks\/[^/]+\.md$/.test(path)) && existsSync(asksTool)) {
  if (spawnSync(process.execPath, [asksTool, 'check'], { stdio: 'inherit' }).status !== 0) process.exit(1);
}

// New plans (docs/plans/*.md, added in this commit) open with a Status
// line that leads with a state: HARD. Their name follows
// <model>-<YYYY-MM-DD>-<slug>.md: WARN. Editing or archiving an existing
// plan never trips either. Skill: .claude/skills/write-plan/.
const STATE = /^(?:\*\*)?Status:(?:\*\*)?\s*(?:`)?(draft|in progress|blocked|finished)\b/im;
const PLAN_NAME = /^docs\/plans\/[a-z][a-z0-9.]*-\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/;
const added = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=A']).split('\0')
  .filter((path) => /^docs\/plans\/[^/]+\.md$/.test(path) && !path.endsWith('/README.md'));
const stateless = added.filter((path) => !STATE.test(git(['show', `:${path}`])));
if (report('commit blocked: a new plan needs a Status line that leads with its state', [
  ...stateless.map((path) => `${path}: add e.g. "Status: draft 2026-11-04: <what it waits on>"`),
  ...(stateless.length ? ['States: draft · in progress · blocked · finished (write-plan skill).'] : []),
])) process.exit(1);
for (const path of added.filter((path) => !PLAN_NAME.test(path))) {
  console.error(`  ~ new plan ${path}: name it <model>-<YYYY-MM-DD>-<slug>.md (e.g. opus-2026-11-04-queue-view.md)`);
}

// Journal (D25): only a commit of JOURNAL_MIN_LINES or more changed
// lines (added + deleted, journal files excluded, binaries count 0)
// needs a project/journal/ entry.
const JOURNAL_MIN_LINES = 30;
const isJournal = (path) => /^project\/journal\/.+\.md$/.test(path) && !path.endsWith('/README.md');
const changedLines = git(['diff', '--cached', '--numstat', '-z', '--no-renames']).split('\0')
  .map((record) => record.split('\t'))
  .filter(([added, deleted, path]) => path !== undefined && !isJournal(path) && added !== '-' && deleted !== '-')
  .reduce((sum, [added, deleted]) => sum + Number(added) + Number(deleted), 0);
if (process.env.SKIP_JOURNAL !== '1' && changedLines >= JOURNAL_MIN_LINES) {
  if (!files.some(isJournal)) {
    report('commit blocked: no journal entry staged', [
      `This commit changes ${changedLines} lines (${JOURNAL_MIN_LINES}+ needs a journal line, D25).`,
      'Add a line or two to project/journal/YYYY-MM-DD-<topic>.md saying',
      'what this commit does and why (informal; see project/journal/README.md),',
      'stage it, and commit again. Genuinely trivial? SKIP_JOURNAL=1 git commit ...',
    ]);
    process.exit(1);
  }
}

if (files.some((path) => /^(\.githooks|\.claude\/hooks|src\/scripts)\//.test(path))) {
  const suite = readdirSync('.githooks').filter((name) => name.endsWith('.test.mjs')).map((name) => `.githooks/${name}`);
  console.error('  - hooks changed: running node --test .githooks/*.test.mjs');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const tests = spawnSync(process.execPath, ['--test', '--test-reporter=dot', ...suite], { encoding: 'utf8', env });
  if (tests.status !== 0) {
    report('commit blocked: hook tests failed', [(tests.stdout + tests.stderr).trim()]);
    process.exit(1);
  }
}
