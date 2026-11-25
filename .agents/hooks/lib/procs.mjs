// Process table helpers for lane cleanup (meta MULTI-AGENT-TOOLING MA11,
// kit copy for REPO-KIT RK-1): .agents/hooks/subagent-cleanup.mjs
// (SubagentStop) and .agents/hooks/session-cleanup.mjs (SessionEnd and
// SessionStart, meta META-CLEAN-2 C8) use them; meta's
// scripts/lane-sweep.mjs has its own copy.
//
// A "lane root" is a directory a lane owns outright: a plan worktree
// (<repo>/.worktrees/<slug>, <repo>/.claude/worktrees/<slug>) or a lane's
// scratch (<repo>/tmp/<lane>), where <repo> is a git repository's top
// level, found with `git`. A repo with no .worktrees/ only has tmp/ roots.
// WS_LANE_SCOPE (or WS_GAMES_ROOT) limits roots to repos inside one
// directory, for tests. Cleanup only ever matches processes by cwd under such a root, by
// ancestry, or by a subagent's own background command; never by name.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, sep } from 'node:path';

/** The one directory (real path) lane roots must sit in, or '' for anywhere. */
export const laneScope = () => {
  const scope = (process.env.WS_LANE_SCOPE || process.env.WS_GAMES_ROOT || '').replace(/\/+$/, '');
  return scope ? real(scope) || scope : '';
};
export const cleanupLog = () => process.env.WS_AUTOCLEAN_LOG || `${homedir()}/.cache/wildshard/autoclean.log`;

const NAME = '[\\w.@+-]+';

function real(path) {
  try {
    return realpathSync(path);
  } catch {
    return '';
  }
}

// Git's environment from a hook that runs inside git would point every
// `git -C` at that repo; strip it.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const tops = new Map();

/** The top level of the git work tree holding dir (a worktree's own root inside one), real path, or ''. */
export function gitTop(dir) {
  if (typeof dir !== 'string' || !dir.startsWith('/')) return '';
  let at = dir;
  while (at !== '/' && !isDir(at)) at = dirname(at);
  if (at === '/') return '';
  if (!tops.has(at)) {
    const git = spawnSync('git', ['-C', at, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: GIT_ENV, timeout: 5000 });
    tops.set(at, git.status === 0 ? real(git.stdout.trim()) : '');
  }
  return tops.get(at);
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const ROOT_RE = new RegExp(`/(?:\\.worktrees|\\.claude/worktrees|tmp)/(?!\\.)${NAME}(?=/|$)`, 'g');

/** The lane root a path sits in (real path), or '' when it is not inside one. */
export function laneRoot(path, base = laneScope()) {
  if (typeof path !== 'string' || !path.startsWith('/')) return '';
  if (base && !path.startsWith(`${base}/`)) return '';
  // The first (outermost) <repo>/(.worktrees|.claude/worktrees|tmp)/<name>
  // whose <repo> is a git top level: everything under a lane's tmp/<lane>
  // or worktree is that lane's, nested clones and their tmp/ included.
  for (const match of path.matchAll(ROOT_RE)) {
    const repo = path.slice(0, match.index);
    if (!repo || (base && !repo.startsWith(`${base}/`)) || !existsSync(repo)) continue;
    const top = real(repo);
    if (top && gitTop(repo) === top) return top + match[0];
  }
  return '';
}

/** True for a process with no controlling terminal: `??` on macOS, `?` on Linux. */
export const noTerminal = (tty) => /^\?+$/.test(tty);

export const isUnder = (path, root) => typeof path === 'string' && root !== '' && (path === root || path.startsWith(root + sep));

/** "[[dd-]hh:]mm:ss" to seconds. */
export function etimeSeconds(etime) {
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime];
  return rest.split(':').map(Number).reduce((total, part) => total * 60 + part, 0) + Number(days) * 86400;
}

/** Every process of this user: { pid, ppid, tty, start (ms, 1 s resolution), command, cwd }. */
export function snapshot() {
  // Elapsed time minus a pre-spawn clock makes processes look too old
  // when ps is delayed by a loaded machine. Read their actual start time.
  const ps = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,lstart=,tty=,command='], { encoding: 'utf8', env: {...process.env, LC_ALL: 'C'}, maxBuffer: 64 * 1024 * 1024 });
  const procs = new Map();
  for (const line of (ps.stdout || '').split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]), start = Date.parse(match[3]);
    if (!Number.isFinite(start)) continue;
    procs.set(pid, { pid, ppid: Number(match[2]), start, tty: match[4], command: match[5], cwd: '' });
  }
  const lsof = process.platform === 'linux' ? { stdout: '' } : spawnSync('lsof', ['-nP', '-w', '-d', 'cwd', '-Fpn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let pid = 0;
  for (const line of (lsof.stdout || '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && procs.has(pid)) procs.get(pid).cwd = line.slice(1);
  }
  if (process.platform === 'linux') {
    for (const proc of procs.values()) {
      if (proc.cwd) continue;
      try {
        proc.cwd = readlinkSync(`/proc/${proc.pid}/cwd`).replace(/ \(deleted\)$/, '');
      } catch {}
    }
  }
  return procs;
}

/** pid and its ancestors, nearest first (stops at 1). */
export function ancestry(procs, pid) {
  const chain = [];
  const seen = new Set();
  let current = procs.get(pid);
  while (current && !seen.has(current.pid) && current.pid > 1) {
    chain.push(current.pid);
    seen.add(current.pid);
    current = procs.get(current.ppid);
  }
  return chain;
}

/** The pids given plus all their descendants. */
export function withDescendants(procs, pids) {
  const children = new Map();
  for (const proc of procs.values()) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc.pid);
  }
  const out = new Set();
  const stack = [...pids];
  while (stack.length) {
    const pid = stack.pop();
    if (out.has(pid)) continue;
    out.add(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  return out;
}

// A land and its main-watch outlive the lane that started them (land.mjs pushes, waits on CI and fast-forwards main
// for up to an hour; main-watch follows main's CI after it). Killing one mid-flight left lands dead with exit 144
// (opus-gcm11, 2026-11-15). main-push.mjs is the other repos' land (meta AGENTS.md: land in the background). Matched
// by the script node runs, never by a bare name. From meta's lib/procs.mjs, with main-push added.
const LANDING = /\bnode\s+(?:\S*\/)?scripts\/(?:land|main-watch|main-push)\.mjs(?:\s|$)/;

/** Every land.mjs, main-push.mjs or main-watch.mjs process, everything it started, and the shells between it and
 * `stop` (the session), which carry its pipes. Cleanup never kills these. */
export function landingSpared(procs, stop = 0) {
  const landing = [...procs.values()].filter((proc) => LANDING.test(proc.command)).map((proc) => proc.pid);
  const spared = withDescendants(procs, landing);
  for (const pid of landing) {
    for (const up of ancestry(procs, pid)) {
      if (up === stop) break;
      spared.add(up);
    }
  }
  return spared;
}

// MINI-DEVEX MD3: a launchd-kept served world (engine serve-keep.mjs) and the phone runner (phone-runner.mjs) outlive
// every lane by design. Each writes its own and its children's pids to ~/.cache/wildshard/kept/<label>.pids, one per
// line; cleanup never kills those, nor what they started. Also matched by the script node runs, never by a bare name.
const KEPT = /\bnode\s+(?:\S*\/)?scripts\/memory\/iphone\/(?:serve-keep|phone-runner)\.mjs(?:\s|$)/;
export const keptDir = () => process.env.WS_KEPT_DIR || `${homedir()}/.cache/wildshard/kept`;

/** A claude or codex session process (the one every subagent's shells run under). */
export function isAgentSession(command) {
  const argv0 = basename(command.split(' ')[0]);
  if (argv0 === 'claude' || argv0 === 'codex') return true;
  return (argv0 === 'node' || argv0 === 'bun') && /\/(?:claude|codex)(?:\.m?js)?(?:\s|$)/.test(command);
}

// A launchd job outlives every lane by design (meta mini-nightkill DF7: launchd's children have ppid 1 and no
// terminal, like a `nohup` server). launchctl list names every job's pid in this user's domains.
/** Pids of this user's running launchd jobs (`launchctl list`); WS_LAUNCHD_PIDS (comma list, may be empty) for tests. */
export function launchdJobs() {
  const forced = process.env.WS_LAUNCHD_PIDS;
  if (forced !== undefined) return forced.split(',').map(Number).filter((pid) => pid > 1);
  if (process.platform !== 'darwin') return [];
  const list = spawnSync('launchctl', ['list'], { encoding: 'utf8', timeout: 5000 });
  return (list.stdout || '').split('\n').map((line) => Number(line.split('\t')[0])).filter((pid) => Number.isInteger(pid) && pid > 1);
}

/** Every launchd job of this user and everything it started, except what runs under a claude or codex session (an
 * iTerm2 window is a launchd job too, and its sessions' lanes are still cleaned). */
export function launchdSpared(procs, jobs = launchdJobs()) {
  const sessions = [...procs.values()].filter((proc) => isAgentSession(proc.command)).map((proc) => proc.pid);
  const agents = withDescendants(procs, sessions);
  return new Set([...withDescendants(procs, jobs.filter((pid) => procs.has(pid)))].filter((pid) => !agents.has(pid)));
}

/** Every kept process (KEPT, or a pid in keptDir()), every launchd job (launchdSpared), and everything they started. */
export function keptSpared(procs, dir = keptDir()) {
  const pids = [...procs.values()].filter((proc) => KEPT.test(proc.command)).map((proc) => proc.pid);
  let files = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.pids'));
  } catch {}
  for (const name of files) {
    try {
      for (const line of readFileSync(`${dir}/${name}`, 'utf8').split('\n')) if (procs.has(Number(line.trim()))) pids.push(Number(line.trim()));
    } catch {}
  }
  return new Set([...withDescendants(procs, pids), ...launchdSpared(procs)]);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** SIGTERM, up to 3 s grace, then SIGKILL. Returns the pids that are gone. */
export function terminate(pids) {
  const sent = [...pids].filter((pid) => {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  });
  for (let waited = 0; waited < 3000 && sent.some(alive); waited += 100) pause(100);
  for (const pid of sent.filter(alive)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  pause(100);
  return sent.filter((pid) => !alive(pid));
}

export function log(line) {
  try {
    const path = cleanupLog();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${new Date().toISOString().slice(0, 19)}Z ${line}\n`);
  } catch {}
}

export const short = (command, width = 100) => (command.length > width ? `${command.slice(0, width - 3)}...` : command);
