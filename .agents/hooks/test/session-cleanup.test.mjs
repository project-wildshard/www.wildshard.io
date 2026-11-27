// meta META-CLEAN-2 C8 (kit port, QA 11-25 row 3): the SessionEnd / SessionStart cleanup hook
// (.agents/hooks/session-cleanup.mjs). Selection tests use fake process rows;
// the SessionEnd integration test owns its sleepers.
// Run: pnpm test:agent-hooks
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkers, procEnviron, select } from '../session-cleanup.mjs';
import { landingSpared } from '../lib/procs.mjs';

const repoDir = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const HOOK = join(repoDir, '.agents/hooks/session-cleanup.mjs');
const NOW = Date.parse('2026-11-25T12:00:00Z');
const HOUR = 3_600_000;
const LOG = join(repoDir, 'tmp/session-cleanup-test.log');
const WORK = join(repoDir, `tmp/session-cleanup-test-${process.pid}`);
after(() => {
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

// Meta QA 11-25 row 23: on Linux every own process's markers are readable, and a CI job runs its steps in one process
// group, so the group rule is off there: the hook passes groupSweep false and only marked processes go.
test('with the group rule off (Linux), only marked processes go, never their unmarked group', () => {
  const procs = table(...base(),
    row(320, 1, 'node -e setTimeout(() => {}, 300000)', { pgid: 8348 }),
    row(321, 1, 'node -e setTimeout(() => {}, 300000)', { owner: 200, pgid: 8348 }),
  );
  assert.deepEqual(killed(select(procs, { now: NOW, groupSweep: false })), [321]);
  assert.deepEqual(killed(select(procs, { now: NOW })), [320, 321]);
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

// Meta QA 11-25 row 23: on a Linux runner the job's node is actions-runner/_work/_tool/node/..., so a marked
// session's process run with it was spared as "the CI runner". Only the runner's own processes are.
test('a job process under the runner\'s _work tree is not the runner; the runner and its externals are', () => {
  const procs = table(...base(),
    row(910, 1, '/home/runner/actions-runner/_work/_tool/node/26.13.1/arm64/bin/node -e setTimeout(() => {}, 300000)', { owner: 200 }),
    row(911, 1, '/home/runner/actions-runner/bin/Runner.Worker spawnclient 1 2'),
    row(912, 911, '/home/runner/actions-runner/externals/node20/bin/node /home/runner/actions-runner/_work/_actions/x/dist/index.js', { owner: 200 }),
    row(913, 1, '/bin/bash /home/runner/actions-runner/run.sh', { owner: 200 }),
  );
  const result = select(procs, { now: NOW });
  assert.deepEqual(killed(result), [910]);
  assert.deepEqual(left(result), [912, 913]);
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

// Linux's ps has no -E, so the hook reads /proc/<pid>/environ there (engine main run 45574235533 went red without it).
test('on Linux the markers come from /proc/<pid>/environ; a gone or foreign process has none', () => {
  const environ = 'PATH=/usr/bin\0CLAUDECODE=1\0CLAUDE_PID=4242\0CLAUDE_CODE_SESSION_ID=abc\0NOTE=a=b\0';
  assert.deepEqual(procEnviron(7, (path) => (assert.equal(path, '/proc/7/environ'), environ)), { CLAUDECODE: '1', CLAUDE_PID: '4242', CLAUDE_CODE_SESSION_ID: 'abc' });
  assert.deepEqual(procEnviron(8, () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); }), {});
});

// The fake session stays outside the gate's protected process tree, but parents its sleepers so it can reap them.
test('SessionEnd, for real: the ended session\'s process dies, the rest live', { timeout: 30_000 }, async (context) => {
  mkdirSync(WORK, { recursive: true });
  const claude = join(WORK, 'claude');
  writeFileSync(join(WORK, 'package.json'), '{"type":"commonjs"}\n');
  writeFileSync(claude, String.raw`
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const children = [];
const signal = AbortSignal.timeout(25_000);
const sleeper = (env) => {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); setTimeout(() => {}, 300000)'],
    { env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  children.push(child);
  return child;
};
const marked = (session) => ({ ...process.env, CLAUDECODE: '1', CLAUDE_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: session });

async function main() {
  // The test releases this pipe after the launcher exits and we are reparented.
  await once(process.stdin, 'data', { signal });
  process.stdin.pause();
  const own = sleeper(marked('fake-end'));
  const other = sleeper(marked('fake-other'));
  const none = sleeper({ PATH: process.env.PATH });
  await Promise.all(children.map(child => once(child.stdout, 'data', { signal })));

  const exit = once(own, 'exit', { signal });
  const hook = spawnSync(process.execPath, [process.argv[2]], {
    input: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'fake-end' }),
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: 10_000,
  });
  const [, killedBy] = await exit;
  assert.equal(hook.status, 0, hook.error?.message);
  assert.match(killedBy, /^SIG(?:TERM|KILL)$/u);
  assert.equal(process.kill(other.pid, 0), true, 'a sleeper from another session id is left');
  assert.equal(process.kill(none.pid, 0), true, 'a sleeper with no marker is left');
  console.log(JSON.stringify({ own: own.pid }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
});
`);
  const launcher = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const session = spawn(process.execPath, process.argv.slice(1), {
      detached: true, stdio: [3, 'inherit', 'inherit'],
    });
    session.unref();
  `, claude, HOOK], {
    env: { ...process.env, WS_CLEANUP_LOG: LOG, WS_CLEANUP_MIN_AGE_MIN: '1000000', WS_LAUNCHD_PIDS: '', WS_SWEEP_KEEP: join(WORK, 'none') },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  launcher.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  launcher.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const closed = once(launcher, 'close', { signal: context.signal });
  // Register both waits before release. The launcher's pipes stay open until the fake session finishes.
  const [launched] = await once(launcher, 'exit', { signal: context.signal });
  assert.equal(launched, 0, stderr);
  launcher.stdio[3].end('start\n');
  await closed;
  assert.ok(stdout.trim(), stderr);
  const { own } = JSON.parse(stdout);
  assert.match(readFileSync(LOG, 'utf8'), new RegExp(`killed ${own} session=\\d+ its session fake-end ended`));
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
