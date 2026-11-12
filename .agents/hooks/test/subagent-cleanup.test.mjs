// Red fixtures for the SubagentStop cleanup hook (meta MULTI-AGENT-TOOLING
// MA11, REPO-KIT RK-1). It builds two git repos under tmp/ (one with a
// .worktrees/ plan worktree and tmp/<lane>, one with only tmp/<lane>) and a
// plain directory, spawns real sleepers in and out of lane roots, runs the
// hook, and checks who died. Red with WS_AUTOCLEAN_DRY=1. macOS only: it
// needs launchd reparenting orphans to pid 1 and `lsof` cwds.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

const repoDir = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const HOOK = join(repoDir, '.agents/hooks/subagent-cleanup.mjs');
mkdirSync(join(repoDir, 'tmp'), { recursive: true });
const work = join(realpathSync(join(repoDir, 'tmp')), `subagent-cleanup-test-${process.pid}`);
const base = join(work, 'games');
const repo = join(base, 'repo-a');
const repoB = join(base, 'repo-b'); // no .worktrees/
const plain = join(base, 'not-a-repo');
const dirs = {
  worktree: join(repo, '.worktrees/slug-a'),
  laneTmp: join(repo, 'tmp/lane-a'),
  otherLane: join(repo, 'tmp/other-lane'),
  outside: join(repo, 'src'),
  laneB: join(repoB, 'tmp/lane-b'),
  plainTmp: join(plain, 'tmp/lane-c'),
};
const logPath = join(work, 'autoclean.log');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|CLAUDE_|WS_GAMES_ROOT$|WS_AUTOCLEAN_MAX_WAIT_MIN$)/.test(key)));
const env = { ...ENV, WS_LANE_SCOPE: base, WS_AUTOCLEAN_LOG: logPath, WS_AUTOCLEAN_SESSION_PID: String(process.pid) };
const darwin = process.platform === 'darwin';
const started = new Set();
const children = new Map();

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** A sleeper that is our child, so it sits under the fake session. */
function child(cwd, seconds = 300, args = null) {
  const proc = args ? spawn('bash', ['-c', args], { cwd, stdio: 'ignore', detached: true }) : spawn('sleep', [String(seconds)], { cwd, stdio: 'ignore' });
  started.add(proc.pid);
  children.set(proc.pid, proc);
  return proc.pid;
}

/** A sleeper reparented to launchd (ppid 1) with no terminal, like a nohup server left by a dead lane. */
async function orphan(cwd, seconds = 300) {
  const sh = spawn('sh', ['-c', `sleep ${seconds} >/dev/null 2>&1 & echo $!`], { cwd, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  sh.stdout.on('data', (chunk) => (out += chunk));
  await new Promise((done) => sh.on('close', done));
  const pid = Number(out.trim());
  started.add(pid);
  return pid;
}

async function alive(pid) {
  const proc = children.get(pid);
  if (proc) {
    for (let i = 0; i < 20 && proc.exitCode === null && proc.signalCode === null; i++) await pause(25);
    return proc.exitCode === null && proc.signalCode === null;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function run(script, args, input = '', extra = {}) {
  return new Promise((done) => {
    const proc = spawn('node', [script, ...args], { env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (chunk) => (out += chunk));
    proc.stderr.on('data', (chunk) => (out += chunk));
    proc.stdin.end(input);
    proc.on('close', (code) => done({ code, out }));
  });
}

before(() => {
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  for (const top of [repo, repoB]) spawnSync('git', ['init', '-q', top], { env: ENV });
});

after(() => {
  for (const pid of started) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGKILL'); // -pid: a detached shell's group, its sleep included
      } catch {}
    }
  }
  rmSync(work, { recursive: true, force: true });
});

test('SubagentStop kills the lane\'s own processes and nothing else', { skip: !darwin && 'macOS process table only' }, async () => {
  const before = child(dirs.worktree); // in its worktree, but running before the subagent began
  await pause(3200);
  const transcript = join(work, 'agent-test.jsonl');
  const line = (command, extra = {}) => JSON.stringify({ timestamp: new Date().toISOString(), cwd: repo, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command, ...extra } }] } });
  writeFileSync(transcript, [
    line('mkdir -p tmp/lane-a && cd tmp/lane-a && nohup ./server &'),
    line(`cd ${dirs.worktree} && pnpm dev`),
    line(`cat ${dirs.otherLane}/out.log`), // reading another lane claims nothing
    line(`mkdir -p ${dirs.laneB} && cd ${dirs.laneB} && ./run`), // a repo with no .worktrees/
    line(`cd ${dirs.plainTmp} && ./run`), // tmp/ in a directory that is not a git repo is no lane root
    line('sleep 302; :', { run_in_background: true }),
  ].join('\n'));

  const inWorktree = child(dirs.worktree);
  const orphanInTmp = await orphan(dirs.laneTmp);
  const shell = child(dirs.outside, 0, "true && eval 'sleep 302; :' < /dev/null");
  const outside = child(dirs.outside);
  const otherLane = child(dirs.otherLane);
  const inRepoB = child(dirs.laneB);
  const inPlain = child(dirs.plainTmp);
  const orphanOutside = await orphan(dirs.outside);
  await pause(300);

  const payload = JSON.stringify({ hook_event_name: 'SubagentStop', cwd: repo, agent_id: 'test', agent_type: 'general-purpose', agent_transcript_path: transcript });
  // 1. Its background shell still runs: the subagent is waiting on it, so nothing dies yet.
  assert.equal((await run(HOOK, [], payload)).code, 0);
  for (const pid of [inWorktree, orphanInTmp, shell]) assert.equal(await alive(pid), true, `deferred while waiting: ${pid} untouched`);
  assert.match(readFileSync(logPath, 'utf8'), /waiting on its own background shell/);

  // 2. A wait past WS_AUTOCLEAN_MAX_WAIT_MIN no longer defers: the shell and the lane's processes go.
  assert.equal((await run(HOOK, [], payload, { WS_AUTOCLEAN_MAX_WAIT_MIN: '0' })).code, 0);
  assert.equal(await alive(inWorktree), false, 'sleeper in the worktree is killed');
  assert.equal(await alive(orphanInTmp), false, 'orphan in tmp/<lane> is killed');
  assert.equal(await alive(shell), false, 'the background shell is killed');
  assert.equal(await alive(outside), true, 'a process outside every lane root is untouched');
  assert.equal(await alive(otherLane), true, 'a lane root only read from is untouched');
  assert.equal(await alive(inRepoB), false, 'tmp/<lane> in a repo without .worktrees/ is cleaned');
  assert.equal(await alive(inPlain), true, 'tmp/<x> outside any git repo is untouched');
  assert.equal(await alive(orphanOutside), true, 'an orphan outside lane roots is untouched');
  assert.equal(await alive(before), true, 'a process older than the subagent is untouched');

  // 3. The wait ended on its own (shell gone): the next stop cleans up without any override.
  const late = child(dirs.worktree);
  await pause(300);
  assert.equal((await run(HOOK, [], payload)).code, 0);
  assert.equal(await alive(late), false, 'after the wait, the lane\'s processes are killed');
});
