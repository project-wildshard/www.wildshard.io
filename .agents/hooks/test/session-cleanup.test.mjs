// meta META-CLEAN-2 C8 (kit port, QA 11-25 row 3): the SessionEnd / SessionStart cleanup hook
// (.agents/hooks/session-cleanup.mjs). The selection is a pure function fed
// with fake process rows, so nothing real is spawned or killed here.
// Run: pnpm test:agent-hooks
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkers, select } from '../session-cleanup.mjs';
import { landingSpared } from '../lib/procs.mjs';

const repoDir = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const HOOK = join(repoDir, '.agents/hooks/session-cleanup.mjs');
const NOW = Date.parse('2026-11-25T12:00:00Z');
const HOUR = 3_600_000;
const LOG = join(repoDir, 'tmp/session-cleanup-test.log');
const WORK = join(repoDir, `tmp/session-cleanup-test-${process.pid}`);
const started = new Set();
after(() => {
  for (const pid of started) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  rmSync(LOG, { force: true });
  rmSync(WORK, { recursive: true, force: true });
});

/** A fake process row; `owner` sets the Claude Code markers (CLAUDE_PID, and `session` its id). */
const row = (pid, ppid, command, { age = HOUR, tty = '??', owner = 0, session = '', pgid = pid } = {}) => ({
  pid, ppid, pgid, start: NOW - age, tty, command,
  env: owner ? { CLAUDECODE: '1', CLAUDE_PID: String(owner), ...(session ? { CLAUDE_CODE_SESSION_ID: session } : {}) } : {},
});
const table = (...rows) => new Map(rows.map((proc) => [proc.pid, proc]));
const killed = (result) => result.kill.map((item) => item.pid);
const left = (result) => result.left.map((item) => item.pid);

// One live session (claude 100 in a herdr pane) and its shell; one dead session (pid 200, gone).
const base = () => [
  row(10, 1, '/opt/homebrew/bin/herdr server', { age: 30 * 24 * HOUR }),
  row(11, 10, '-zsh', { tty: 'ttys001', age: 24 * HOUR }),
  row(100, 11, 'claude --remote-control', { tty: 'ttys001', age: 10 * HOUR }),
  row(101, 100, "/bin/bash -c eval 'tail -F lane-receipts.log | ugrep x' < /dev/null", { owner: 100, session: 'live' }),
];

test('an orphan of an ended session is killed, with what it started', () => {
  const procs = table(...base(),
    row(300, 1, 'tail -F lane-receipts.log', { owner: 200, session: 'dead' }),
    row(301, 1, 'node dev-server.mjs', { owner: 200, session: 'dead' }),
    row(302, 301, 'node worker.mjs'), // no marker of its own: it goes with its parent
  );
  const result = select(procs, { now: NOW });
  assert.deepEqual(killed(result), [300, 301, 302]);
  assert.match(result.kill[0].reason, /session process 200 is gone/);
});

test('a watch loop goes whole: the unreadable tail shares the marked ugrep\'s process group', () => {
  const procs = table(...base(),
    row(310, 1, 'tail -n +1 -f tmp/lane/proof.log'), // /usr/bin/tail: ps cannot read its environment
    row(311, 1, 'ugrep -E RED|exit', { owner: 200, pgid: 310 }),
    row(312, 1, 'tail -f /dev/null', { pgid: 999 }), // unmarked and in no ended group: left alone
    row(102, 101, 'tail -F lane-receipts.log', { pgid: 101 }), // the live session's loop
  );
  const result = select(procs, { now: NOW });
  assert.deepEqual(killed(result), [310, 311]);
  assert.match(result.kill[0].reason, /process group 310 with 311/);
});

test('a live session\'s processes are left alone', () => {
  const result = select(table(...base()), { now: NOW });
  assert.deepEqual(killed(result), []);
  assert.deepEqual(left(result), []);
});

test('a --keep server and what it started are left', () => {
  const procs = table(...base(),
    row(400, 1, 'node scripts/serve-local.mjs --public --keep', { owner: 200 }),
    row(401, 400, 'node world.mjs', { owner: 200 }),
    row(402, 1, '/bin/sh -c ./keep-alive', { pgid: 400 }), // unreadable, in the kept world's group: not pulled in
  );
  const result = select(procs, { now: NOW });
  assert.deepEqual(killed(result), []);
  assert.deepEqual(left(result), [400, 401]);
  assert.match(result.left[1].reason, /--keep process 400/);
});

test('a process with no agent marker is never a candidate', () => {
  const procs = table(...base(), row(500, 1, 'tail -f /dev/null', { age: 19 * 24 * HOUR }), row(501, 1, '/opt/homebrew/bin/idb_companion --udid X'));
  assert.deepEqual(killed(select(procs, { now: NOW })), []);
});

test('SessionEnd kills only the ending session\'s processes', () => {
  const procs = table(...base(),
    row(110, 1, 'tail -F receipts', { owner: 100, session: 'live', age: 1000 }), // young, but its session is ending
    row(111, 100, 'sleep 600', { owner: 100, session: 'after-clear' }), // started after a /clear: a new session
    row(120, 11, 'claude', { tty: 'ttys001' }), // another live session in the same pane tree
    row(121, 120, 'node server.mjs', { owner: 120, session: 'other' }),
  );
  const result = select(procs, { now: NOW, ended: { pid: 100, session: 'live' }, protect: new Set([100, 11, 10]) });
  assert.deepEqual(killed(result), [101, 110]);
});

test('herdr, its panes and a live claude are never touched, even with a dead marker', () => {
  const procs = table(
    row(10, 1, '/opt/homebrew/bin/herdr server', { owner: 200 }), // herdr started from a session that has since ended
    row(11, 10, '-zsh', { owner: 200 }),
    row(12, 10, '-zsh', { owner: 200 }), // an idle pane
    row(100, 11, 'claude', { owner: 200 }),
    row(101, 100, 'bash -c eval x', { owner: 100 }),
  );
  const result = select(procs, { now: NOW });
  assert.deepEqual(killed(result), []);
  assert.deepEqual(left(result), [10, 11, 12, 100, 101]);
});

test('pid reuse: a CLAUDE_PID that is now another process or a younger claude counts as gone', () => {
  const procs = table(...base(),
    row(600, 1, 'sleep 99999', { owner: 700, age: 5 * HOUR }),
    row(700, 1, 'node unrelated.mjs', { age: 1000 }),
    row(601, 1, 'sleep 99999', { owner: 800, age: 5 * HOUR }),
    row(800, 11, 'claude', { tty: 'ttys001', age: HOUR }), // started after 601: not its session
  );
  assert.deepEqual(killed(select(procs, { now: NOW })), [600, 601]);
});

test('a young orphan, a process with a terminal, an app, a land and a kept pid are left', () => {
  const procs = table(...base(),
    row(900, 1, 'sleep 30', { owner: 200, age: 5000 }),
    row(901, 1, 'vim notes', { owner: 200, tty: 'ttys009' }),
    row(902, 1, '/Applications/AltTab.app/Contents/MacOS/AltTab', { owner: 200 }),
    row(903, 1, 'node scripts/land.mjs', { owner: 200 }),
    row(904, 1, 'node watcher.mjs keep-me', { owner: 200 }),
    row(905, 1, '/home/runner/actions-runner/bin/Runner.Listener run', { owner: 200 }),
  );
  const result = select(procs, { now: NOW, spared: new Map([[903, 'a land or its main-watch']]), keep: ['keep-me'] });
  assert.deepEqual(killed(result), []);
  assert.deepEqual(left(result), [901, 902, 903, 904, 905]);
});

test('parseMarkers reads the environment after the command', () => {
  const line = 'node dev.mjs TERM=xterm CLAUDECODE=1 CLAUDE_PID=35321 CLAUDE_CODE_SESSION_ID=abc-1 HOME=/Users/x';
  assert.deepEqual(parseMarkers(line), { CLAUDECODE: '1', CLAUDE_PID: '35321', CLAUDE_CODE_SESSION_ID: 'abc-1' });
  assert.deepEqual(parseMarkers('tail -f /dev/null'), {});
});

test('the hook exits 0 on bad input and an unknown event, and a dry sweep kills nothing', () => {
  const env = { ...process.env, WS_CLEANUP_LOG: LOG };
  for (const input of ['not json', '{"hook_event_name":"Stop"}']) {
    const run = spawnSync('node', [HOOK], { input, env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(run.status, 0);
  }
  const dry = spawnSync('node', [HOOK, '--sweep'], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /session-cleanup: \d+ to kill, \d+ left \(dry run/);
});

// End to end with real processes: a fake session process named `claude` starts three sleepers (its own, one from
// another session id, one with no marker), then runs the hook as its SessionEnd. Only its own sleeper may die.
test('SessionEnd, for real: the ended session\'s process dies, the rest live', async () => {
  mkdirSync(WORK, { recursive: true });
  const claude = join(WORK, 'claude');
  // The kit is "type": "module"; the fake session is CommonJS.
  writeFileSync(join(WORK, 'package.json'), '{"type":"commonjs"}\n');
  writeFileSync(claude,`#!/usr/bin/env node
const { spawn, spawnSync } = require('node:child_process');
// Each sleeper is orphaned (its sh exits) in its own process group (set -m): run under a land or main-push, a child
// of this fake session would be spared as part of that land's tree, which is the hook working, not this case.
const sleeper = (env) => Number(spawnSync('/bin/sh', ['-c', 'set -m; "$0" -e "setTimeout(() => {}, 300000)" </dev/null >/dev/null 2>&1 & echo $!', process.execPath], { env, encoding: 'utf8' }).stdout.trim());
const marked = (session) => ({ ...process.env, CLAUDECODE: '1', CLAUDE_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: session });
const plain = { PATH: process.env.PATH };
const own = sleeper(marked('fake-end')), other = sleeper(marked('fake-other')), none = sleeper(plain);
setTimeout(() => {
  process.stdout.write(JSON.stringify({ own, other, none }) + '\\n');
  spawnSync(process.execPath, [process.argv[2]], { input: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'fake-end' }), stdio: ['pipe', 'inherit', 'inherit'] });
}, 300);
`);
  chmodSync(claude, 0o755);
  const env = { ...process.env, WS_CLEANUP_LOG: LOG, WS_CLEANUP_MIN_AGE_MIN: '1000000', WS_LAUNCHD_PIDS: '', WS_SWEEP_KEEP: join(WORK, 'none') };
  const run = spawnSync(process.execPath, [claude, HOOK], { env, encoding: 'utf8', timeout: 20_000 });
  const pids = JSON.parse(run.stdout.trim().split('\n')[0]);
  for (const pid of Object.values(pids)) started.add(pid);
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(alive(pids.own), false, 'the ended session\'s sleeper is killed');
  assert.equal(alive(pids.other), true, 'a sleeper from another session id is left');
  assert.equal(alive(pids.none), true, 'a sleeper with no marker is left');
  assert.match(readFileSync(LOG, 'utf8'), new RegExp(`killed ${pids.own} session=\\d+ its session fake-end ended`));
});

test('a land, a main-push and a main-watch, and what they started, are spared; the session itself is not', () => {
  const procs = table(...base(),
    row(950, 101, 'node scripts/main-push.mjs -m fix: x -- a.ts', { owner: 100 }),
    row(951, 950, 'git push origin main', { owner: 100 }),
    row(952, 1, 'node /x/engine/scripts/land.mjs', { owner: 200 }),
    row(953, 1, 'node scripts/main-watch.mjs', { owner: 200 }),
    row(954, 1, 'node scripts/main-pushy.mjs', { owner: 200 }),
  );
  const spared = landingSpared(procs, 100);
  for (const pid of [950, 951, 952, 953, 101]) assert.ok(spared.has(pid), `spares ${pid}`);
  for (const pid of [100, 954]) assert.ok(!spared.has(pid), `does not spare ${pid}`);
});
