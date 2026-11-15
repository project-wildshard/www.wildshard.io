// WORKTREE-LAND-STANDARD WL3: the real-git fixture behind test/tooling/land*.test.mjs (three files, so node --test
// runs them side by side). A bare repo stands in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook), a post-receive hook records every pushed tip, and a fake `gh`, named by the fixture's land.config.json,
// answers Actions queries only for SHAs that were really pushed. No test reaches GitHub, and no fixture runs the real
// pnpm. Ported from engine's test/land.test.ts (J240, DEV-SPEED DS21).
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { after } from 'node:test';
import { scratchDir } from '../../scripts/scratch-dir.mjs';
import { fileURLToPath } from 'node:url';

export const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LAND = join(KIT, 'scripts/land.mjs');
const task = process.env.WS_LANE_NAME ?? `test-disk-${process.pid}`;
const parent = resolve(KIT, 'tmp', task), parentExisted = existsSync(parent);
scratchDir(task, 'SDK disk fixtures', { root: KIT, env: { ...process.env, WS_LANE_NAME: task } });
export const SCRATCH = join(parent, 'land-test');
export const ENGINE_CONFIG = {};
/** The two configs under test: the kit default (only the CI stub set) and engine's. */
export const CONFIGS = { default: {}, engine: ENGINE_CONFIG };
const roots = [];
/** Remove `root` with the fixtures when the file's tests end. @param {string} root */
export const track = (root) => { roots.push(root); };
// Each fixture is its own folder; they go once the file's tests end.
after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  try { if (readdirSync(SCRATCH).length === 0) rmSync(SCRATCH, { recursive: true }); } catch { /* already gone */ }
  if (!parentExisted && readdirSync(parent).every(name => name === '.owner')) rmSync(parent, { recursive: true });
});

const FAKE_GH = `#!/usr/bin/env node
// Answers the Actions queries land makes, from the remote's pushed-tip log.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
fs.appendFileSync(state.log, process.argv.slice(2).join(' ') + '\\n');
const args = process.argv.slice(2);
if (args[0] === 'run' && args[1] === 'download') {
  const dir = args[args.indexOf('-D') + 1];
  if (state.flaky !== undefined) {
    for (const job of state.flaky.jobs ?? [1]) {
      fs.mkdirSync(dir + '/engine-ci-' + job + '/engine-ci', { recursive: true });
      fs.mkdirSync(dir + '/engine-ci-' + job + '/ci-pack', { recursive: true });
      fs.writeFileSync(dir + '/engine-ci-' + job + '/ci-pack/job-' + job + '.json', JSON.stringify({ pinsCode: 0, units: [{ name: 'shard:' + job, blocking: true, code: 1 }, { name: 'static', blocking: true, code: 0 }] }));
      fs.writeFileSync(dir + '/engine-ci-' + job + '/engine-ci/shard-' + job + '-ordinary.json', JSON.stringify({ files: [{ file: state.flaky.file, state: 'failed', durationMs: 900 }, { file: 'test/fine.test.ts', state: 'passed', durationMs: 10 }] }));
      fs.writeFileSync(dir + '/engine-ci-' + job + '/engine-ci/shard-' + job + '-wall.json', JSON.stringify({ overBudget: false }));
    }
  }
  process.exit(0);
}
if (args[0] === 'run' && args[1] === 'rerun') {
  state.reran = [...(state.reran ?? []), Number(args[2])];
  if (state.flaky?.stillRed !== true) state.red = {};
  fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
  process.exit(0);
}
const path = process.argv[3] ?? '';
const read = () => fs.existsSync(state.pushed) ? fs.readFileSync(state.pushed, 'utf8').trim().split('\\n').filter(Boolean).map(line => line.split(' ')) : [];
const runId = (sha, name) => parseInt(sha.slice(0, 6), 16) * 10 + (name === 'ci' ? 1 : 2);
const sha = /head_sha=([a-f0-9]{40})/.exec(path)?.[1];
if (sha !== undefined) {
  if (state.once !== undefined && !fs.existsSync(state.once.marker)) {
    fs.writeFileSync(state.once.marker, '');
    execFileSync(state.once.command[0], state.once.command.slice(1), { stdio: 'ignore' });
  }
  const branches = [...new Set(read().filter(([, tip]) => tip === sha).map(([ref]) => ref.replace('refs/heads/', '')))];
  const workflow_runs = branches.flatMap(branch => (state.workflows ?? ['ci']).map(name => {
    const red = state.red?.[branch]?.[name];
    return { id: runId(sha, name), run_attempt: (state.reran ?? []).includes(runId(sha, name)) ? 2 : 1, name, event: 'push', head_sha: sha, head_branch: branch, status: 'completed', conclusion: red === undefined ? 'success' : 'failure', html_url: '' };
  }));
  process.stdout.write(JSON.stringify({ workflow_runs }));
} else if (/actions\\/runs\\/\\d+$/.test(path)) {
  const id = Number(/runs\\/(\\d+)$/.exec(path)?.[1]);
  const red = Object.values(state.red ?? {}).some(names => Object.keys(names).includes(id % 10 === 1 ? 'ci' : 'ring-1'));
  process.stdout.write(JSON.stringify({ id, status: 'completed', conclusion: red ? 'failure' : 'success', run_attempt: (state.reran ?? []).includes(id) ? 2 : 1 }));
} else {
  const id = Number(/runs\\/(\\d+)\\/jobs/.exec(path)?.[1]);
  const jobs = [];
  for (const [branch, names] of Object.entries(state.red ?? {})) for (const [name, job] of Object.entries(names)) jobs.push({ name: job, conclusion: 'failure', run: name, branch });
  process.stdout.write(JSON.stringify({ jobs: jobs.filter(job => id % 10 === (job.run === 'ci' ? 1 : 2)).map(({ name, conclusion }) => ({ name, conclusion, steps: [{ name: "Run this job's packed share", conclusion: 'failure' }, ...(state.flaky?.wallRed === true ? [{ name: "Record every shard's wall-budget verdict", conclusion: 'failure' }] : [])] })) }));
}
`;

const PROTECT_MAIN = `#!/bin/sh
# GitHub's protect-main ruleset: no deletion and no non-fast-forward on main.
[ "$1" = refs/heads/main ] || exit 0
zero=0000000000000000000000000000000000000000
[ "$2" = $zero ] && exit 0
[ "$3" = $zero ] && { echo "protect-main: deletion refused"; exit 1; }
git merge-base --is-ancestor "$2" "$3" || { echo "protect-main: non-fast-forward refused"; exit 1; }
`;

const POST_RECEIVE = `#!/bin/sh
while read old new ref; do echo "$ref $new" >> "$PUSHED_LOG"; done
`;

// The fixture pre-push records what land asked for and can fail or race on demand.
const PRE_PUSH = `#!/bin/sh
refs=$(cat)
echo "land=\${WS_LAND_MAIN_PUSH:-0} $refs" >> "$PREPUSH_LOG"
[ -f "$PREPUSH_FAIL" ] && { echo "pre-push: planted red check"; exit 1; }
case "$refs" in *refs/heads/main*) if [ -f "$PREPUSH_RACE" ]; then rm "$PREPUSH_RACE"; sh "$RACE_SCRIPT"; fi ;; esac
exit 0
`;

/**
 * A canonical checkout cloned from a bare remote, a peer clone, a fake gh and pnpm, and a land.config.json.
 * @param {Record<string, unknown> | null} config the repo's land.config.json, `gh` added; null writes no file
 */
export function fixture(config = {}) {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, 'land-'));
  roots.push(root);
  const remote = join(root, 'remote.git'), repo = join(root, 'repo'), peer = join(root, 'peer'), bin = join(root, 'bin'), hooks = join(root, 'hooks');
  const files = { pushed: join(root, 'pushed.log'), gh: join(root, 'gh.log'), prepush: join(root, 'prepush.log'), receipts: join(root, 'receipts.log'), state: join(root, 'gh-state.json'), fail: join(root, 'prepush-fail'), race: join(root, 'prepush-race'), raceScript: join(root, 'race.sh') };
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Land', GIT_AUTHOR_EMAIL: 'land@example.test', GIT_COMMITTER_NAME: 'Land', GIT_COMMITTER_EMAIL: 'land@example.test',
    PATH: `${bin}:${process.env['PATH'] ?? ''}`, FAKE_GH_STATE: files.state, PUSHED_LOG: files.pushed, PREPUSH_LOG: files.prepush,
    PREPUSH_FAIL: files.fail, PREPUSH_RACE: files.race, RACE_SCRIPT: files.raceScript,
    WS_LAND_REPO: 'project-wildshard/fixture', WS_FLAKE_STRIKES: join(root, 'strikes.jsonl'), WS_LANE_RECEIPTS: files.receipts, WS_LANE_NAME: 'fixture-lane', HERDR_PANE_ID: 'w0:p9',
    WS_STORE_USERS: join(root, 'store-users'), WS_STORE_RESERVATION: join(root, 'store-maintenance.lock'),
    WS_SESSION_KEEP_ROOT: join(root, 'session-keep'),
  };
  for (const key of Object.keys(env)) if ((key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].includes(key)) || key.startsWith('NODE_TEST')) Reflect.deleteProperty(env, key);
  const git = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, text, mode) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); if (mode !== undefined) chmodSync(path, mode); };

  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  write(join(remote, 'hooks/update'), PROTECT_MAIN, 0o755);
  write(join(remote, 'hooks/post-receive'), POST_RECEIVE, 0o755);
  // The CI stub sits behind the config: land.config.json's `gh` names this fake (a copy also answers on PATH for
  // the no-config case). A fixture never runs the real pnpm either.
  write(join(root, 'ci-stub/gh'), FAKE_GH, 0o755);
  write(join(bin, 'gh'), FAKE_GH, 0o755);
  write(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', 0o755);
  write(join(hooks, 'pre-push'), PRE_PUSH, 0o755);
  writeFileSync(files.state, JSON.stringify({ log: files.gh, pushed: files.pushed }));

  git(root, ['clone', '--quiet', remote, repo]);
  const lines = Array.from({ length: 12 }, (_, index) => `export const line${index} = ${index};`).join('\n');
  write(join(repo, 'src/shared.ts'), `${lines}\n`);
  write(join(repo, 'src/a.ts'), 'export const a = 1;\n');
  const seed = ['src'];
  if (config !== null) {
    write(join(repo, 'land.config.json'), `${JSON.stringify({ ...config, gh: join(root, 'ci-stub/gh') }, null, 2)}\n`);
    seed.push('land.config.json');
  }
  git(repo, ['add', ...seed]);
  git(repo, ['commit', '--quiet', '-m', 'seed']);
  git(repo, ['push', '--quiet', 'origin', 'main']);
  git(repo, ['config', 'core.hooksPath', hooks]);
  git(root, ['clone', '--quiet', remote, peer]);

  const worktree = (slug) => {
    const path = join(repo, '.worktrees', slug);
    git(repo, ['fetch', '--quiet', 'origin']);
    git(repo, ['worktree', 'add', '--quiet', '-b', `plan/${slug}`, path, 'origin/main']);
    return path;
  };
  const commit = (cwd, path, text, message) => { write(join(cwd, path), text); git(cwd, ['add', path]); git(cwd, ['commit', '--quiet', '-m', message]); return git(cwd, ['rev-parse', 'HEAD']); };
  const edit = (cwd, path, from, to, message) => commit(cwd, path, readFileSync(join(cwd, path), 'utf8').replace(from, to), message);
  /** A peer lands on main: the script a hook runs to move main mid-landing. */
  const peerScript = (path, from, to) => {
    const script = join(root, `peer-${Math.random().toString(16).slice(2)}.sh`);
    const change = from === null
      ? `mkdir -p "$(dirname '${path}')" && printf '%s\\n' '${to}' > '${path}'`
      : `node -e "const fs=require('fs');fs.writeFileSync('${path}',fs.readFileSync('${path}','utf8').replace('${from}','${to}'))"`;
    write(script, `set -e\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR\ncd '${peer}'\ngit pull --quiet --ff-only origin main\n${change}\ngit add '${path}'\ngit commit --quiet -m 'peer lands'\ngit push --quiet origin HEAD:main\n`);
    return script;
  };
  const state = (extra) => writeFileSync(files.state, JSON.stringify({ log: files.gh, pushed: files.pushed, ...extra }));
  const KEPT = ['--keep'];
  const land = (cwd, args = KEPT) => spawnSync(process.execPath, [LAND, '--poll=0.05', '--appear=0.05', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  const landAsync = (cwd) => new Promise(done => {
    const child = execFile(process.execPath, [LAND, '--poll=0.05', '--appear=0.05', ...KEPT], { cwd, env, encoding: 'utf8', timeout: 60_000 }, (error, stdout) => { done({ code: error === null ? 0 : (typeof error.code === 'number' ? error.code : 1), stdout }); });
    child.stdin?.end();
  });
  const remoteMain = () => git(remote, ['rev-parse', 'main']);
  const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  const fakePnpm = (log) => { write(join(bin, 'pnpm'), `#!/bin/sh\necho "$*" >> '${log}'\n`, 0o755); };
  return { root, remote, repo, peer, env, files, git, worktree, commit, edit, peerScript, state, land, landAsync, remoteMain, read, fakePnpm };
}

export const prepushLines = (f) => f.read(f.files.prepush).trim().split('\n').filter(Boolean);
export const LONG = { timeout: 90_000 };
