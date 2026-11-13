// Fixture tests for the SessionEnd scratch hook (meta REPO-DISK-PLAN DK4).
// Each case copies the hook into a fresh fake repo under this repo's tmp/,
// plants tmp/<task>/ folders with and without .owner, .keep, symlinks and a
// live process cwd, runs the hook with a SessionEnd payload and checks what
// is left. Targets outside the fake repo's tmp/ must survive every case.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'scratch-end.mjs');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRATCH_DIR = join(REPO, 'scripts', 'scratch-dir.mjs');
mkdirSync(join(REPO, 'tmp'), { recursive: true });
const work = join(realpathSync(join(REPO, 'tmp')), `scratch-end-test-${process.pid}`);
const sleepers = [];
after(() => {
  for (const proc of sleepers) proc.kill('SIGKILL');
  rmSync(work, { recursive: true, force: true });
});

const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CLAUDE_|WS_SCRATCH_)/.test(key)));
const ME = 'sess-ending';
let boxes = 0;

/** A fake repo holding a copy of the hook, plus an outside folder symlinks point at. */
function box() {
  const root = join(work, `box-${++boxes}`);
  const repo = join(root, 'repo');
  const outside = join(root, 'outside');
  mkdirSync(join(repo, '.agents', 'hooks'), { recursive: true });
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  cpSync(HOOK, join(repo, '.agents', 'hooks', 'scratch-end.mjs'));
  cpSync(SCRATCH_DIR, join(repo, 'scripts', 'scratch-dir.mjs'));
  mkdirSync(join(repo, 'tmp'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'precious.txt'), 'keep me\n');
  writeFileSync(join(outside, '.owner'), JSON.stringify({ task: 'linked', session: ME }));
  return { repo, outside, tmp: join(repo, 'tmp') };
}

/** tmp/<name>/ with a .owner (an object, raw text, or none) and a payload file. */
function folder(tmp, name, owner) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'build.bin'), 'x'.repeat(1024));
  if (typeof owner === 'string') writeFileSync(join(dir, '.owner'), owner);
  else if (owner) writeFileSync(join(dir, '.owner'), JSON.stringify(owner));
  return dir;
}
const own = (name, session = ME) => ({ task: name, session, lane: 'opus-x', pane: null, started: '2026-11-13T00:00:00.000Z', purpose: 'test' });

function run(repo, payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync(process.execPath, [join(repo, '.agents', 'hooks', 'scratch-end.mjs')], { cwd: repo, input, encoding: 'utf8', env: { ...ENV, WS_SCRATCH_SYNC: '1', ...env } });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
const end = (session = ME, extra = {}) => ({ session_id: session, transcript_path: null, cwd: '/somewhere/else', hook_event_name: 'SessionEnd', reason: 'exit', ...extra });
const names = (tmp) => readdirSync(tmp).filter((name) => !name.startsWith('.')).sort();
const scratchLog = (tmp) => (existsSync(join(tmp, '.scratch.log')) ? readFileSync(join(tmp, '.scratch.log'), 'utf8') : '');

test('removes only the ending session\'s folders; .keep, busy, other sessions and no owner stay', async () => {
  const { repo, tmp } = box();
  folder(tmp, 'mine', own('mine'));
  folder(tmp, 'mine-kept', own('mine-kept'));
  writeFileSync(join(tmp, 'mine-kept', '.keep'), 'the verdict screenshots\n');
  const busy = folder(tmp, 'mine-busy', own('mine-busy'));
  mkdirSync(join(busy, 'deep'));
  const sleeper = spawn('sleep', ['60'], { cwd: join(busy, 'deep'), stdio: 'ignore' });
  sleepers.push(sleeper);
  await new Promise((done) => sleeper.once('spawn', done));
  folder(tmp, 'theirs', own('theirs', 'sess-other'));
  folder(tmp, 'ownerless', null);
  folder(tmp, 'garbled', '{ not json');
  folder(tmp, 'renamed', own('original-name'));
  folder(tmp, 'no-session', { task: 'no-session' });
  writeFileSync(join(tmp, 'loose-file'), 'not a folder\n');

  run(repo, end());
  assert.deepEqual(names(tmp), ['garbled', 'loose-file', 'mine-busy', 'mine-kept', 'no-session', 'ownerless', 'renamed', 'theirs']);
  assert.ok(existsSync(join(tmp, 'mine-kept', 'build.bin')));
  assert.ok(existsSync(join(tmp, 'mine-busy', 'build.bin')));
  const log = scratchLog(tmp);
  assert.match(log, /session=sess-ending removed tmp\/mine\n/);
  assert.match(log, /kept tmp\/mine-kept \(\.keep\)/);
  assert.match(log, /kept tmp\/mine-busy \(busy: a process cwd is inside\)/);
  assert.match(log, /kept tmp\/renamed \(\.owner names task "original-name"\)/);
  assert.match(log, /done: 1 removed, 3 kept, 4 not this session's/);
  assert.doesNotMatch(log, /theirs|ownerless|garbled/);
  assert.deepEqual(readdirSync(join(tmp, '.scratch-trash')), []);
});

test('never follows a symlink out of tmp/', () => {
  const { repo, outside, tmp } = box();
  // tmp/linked -> outside/, which holds a .owner naming this session.
  symlinkSync(outside, join(tmp, 'linked'));
  // An owned folder holding links to an outside folder and file.
  const dir = folder(tmp, 'mine', own('mine'));
  symlinkSync(outside, join(dir, 'out-dir'));
  symlinkSync(join(outside, 'precious.txt'), join(dir, 'out-file'));
  // An owned-looking folder whose .owner is a symlink to a matching file.
  const fake = folder(tmp, 'linked-owner', null);
  writeFileSync(join(outside, 'owner.json'), JSON.stringify(own('linked-owner')));
  symlinkSync(join(outside, 'owner.json'), join(fake, '.owner'));

  run(repo, end());
  assert.deepEqual(names(tmp), ['linked', 'linked-owner']);
  assert.deepEqual(readdirSync(outside).sort(), ['.owner', 'owner.json', 'precious.txt']);
  assert.equal(readFileSync(join(outside, 'precious.txt'), 'utf8'), 'keep me\n');
  assert.ok(existsSync(join(fake, 'build.bin')));
});

test('a tmp/ that is a symlink is never touched', () => {
  const { repo, outside, tmp } = box();
  rmSync(tmp, { recursive: true });
  folder(outside, 'mine', own('mine'));
  symlinkSync(outside, tmp);
  run(repo, end());
  assert.ok(existsSync(join(outside, 'mine', 'build.bin')));
  assert.ok(!existsSync(join(outside, '.scratch.log')));
});

test('no session id, a bad payload or no tmp/ removes nothing', () => {
  const { repo, tmp } = box();
  folder(tmp, 'mine', own('mine'));
  folder(tmp, 'empty-session', own('empty-session', ''));
  for (const payload of ['', 'not json', '[]', end(''), { hook_event_name: 'SessionEnd' }]) run(repo, payload);
  assert.deepEqual(names(tmp), ['empty-session', 'mine']);
  rmSync(tmp, { recursive: true });
  run(repo, end());
  assert.ok(!existsSync(tmp));
});

test('dry run logs what it would remove and removes nothing', () => {
  const { repo, tmp } = box();
  folder(tmp, 'mine', own('mine'));
  folder(tmp, 'theirs', own('theirs', 'sess-other'));
  run(repo, end(), { WS_SCRATCH_DRY: '1' });
  assert.deepEqual(names(tmp), ['mine', 'theirs']);
  assert.ok(!existsSync(join(tmp, '.scratch-trash')));
  assert.match(scratchLog(tmp), /would remove tmp\/mine \(dry run\)[\s\S]*done: 1 would be removed, 0 kept, 1 not this session's/);
});

test('scratch-dir and the hook agree: the Claude session that made a folder removes it, no other session does', () => {
  const { repo, tmp } = box();
  const make = (task, env) => {
    const result = spawnSync(process.execPath, [join(repo, 'scripts', 'scratch-dir.mjs'), task, 'dk4 test'], { cwd: repo, encoding: 'utf8', env: { ...ENV, ...env } });
    assert.equal(result.status, 0, result.stderr);
  };
  make('claude-a', { CLAUDE_CODE_SESSION_ID: 'aaaa-1111' });
  make('claude-b', { CLAUDE_CODE_SESSION_ID: 'bbbb-2222' });
  make('codex-lane', { WS_LANE_NAME: 'codex-x1' });
  run(repo, end('bbbb-2222'));
  assert.deepEqual(names(tmp), ['claude-a', 'codex-lane']);
  // A Codex session id never matches a lane-named .owner: DK6's sweep takes those.
  run(repo, end('01a1c8a0-33db-7521-8617-e1927bd16259', { model: 'gpt-6.1-sol', permission_mode: 'bypassPermissions' }));
  assert.deepEqual(names(tmp), ['claude-a', 'codex-lane']);
  run(repo, end('aaaa-1111'));
  assert.deepEqual(names(tmp), ['codex-lane']);
});

test('a session id that is not a plain id removes nothing and writes no log line', () => {
  const { repo, tmp } = box();
  const forged = 'x removed tmp/everything\n2026 session=y';
  folder(tmp, 'mine', own('mine', forged));
  run(repo, end(forged));
  assert.deepEqual(names(tmp), ['mine']);
  assert.equal(scratchLog(tmp), '');
});

test('a slow, partial or failing lsof removes nothing, inside the SessionEnd budget', { skip: process.platform === 'linux' ? 'Linux reads /proc' : false }, () => {
  for (const body of ['echo n/; sleep 2', 'echo n/; exit 1']) {
    const { repo, tmp } = box();
    folder(tmp, 'mine', own('mine'));
    const bin = join(repo, 'fake-bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'lsof'), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, 'lsof'), 0o755);
    const startedAt = Date.now();
    run(repo, end(), { PATH: `${bin}:${process.env.PATH}` });
    assert.ok(Date.now() - startedAt < 1500, `took ${Date.now() - startedAt} ms`);
    assert.deepEqual(names(tmp), ['mine'], body);
    assert.match(scratchLog(tmp), /kept tmp\/mine \(process cwds unreadable\)/);
  }
});

test('a tmp/.scratch-trash that is a symlink is never emptied or used', () => {
  const { repo, outside, tmp } = box();
  folder(tmp, 'mine', own('mine'));
  symlinkSync(outside, join(tmp, '.scratch-trash'));
  run(repo, end());
  const purge = spawnSync(process.execPath, [join(repo, '.agents', 'hooks', 'scratch-end.mjs'), '--purge'], { cwd: repo, encoding: 'utf8', env: ENV });
  assert.equal(purge.status, 0);
  assert.deepEqual(readdirSync(outside).sort(), ['.owner', 'precious.txt']);
  assert.deepEqual(names(tmp), ['mine']);
  assert.match(scratchLog(tmp), /kept tmp\/mine \(remove failed: EEXIST/);
});

test('without WS_SCRATCH_SYNC the folder leaves at once and a detached purge empties the trash', async () => {
  const { repo, tmp } = box();
  folder(tmp, 'mine', own('mine'));
  mkdirSync(join(tmp, '.scratch-trash'));
  folder(join(tmp, '.scratch-trash'), 'left-by-a-killed-purge', null);
  run(repo, end(), { WS_SCRATCH_SYNC: '' });
  assert.deepEqual(names(tmp), []);
  for (let i = 0; i < 100 && readdirSync(join(tmp, '.scratch-trash')).length > 0; i++) await new Promise((done) => setTimeout(done, 50));
  assert.deepEqual(readdirSync(join(tmp, '.scratch-trash')), []);
});
