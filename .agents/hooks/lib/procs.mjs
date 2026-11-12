// Process table helpers for lane cleanup (meta MULTI-AGENT-TOOLING MA11,
// kit copy for REPO-KIT RK-1): .agents/hooks/subagent-cleanup.mjs
// (SubagentStop) uses them; meta's scripts/lane-sweep.mjs has its own copy.
//
// A "lane root" is a directory a lane owns outright: a plan worktree
// (<repo>/.worktrees/<slug>, <repo>/.claude/worktrees/<slug>) or a lane's
// scratch (<repo>/tmp/<lane>), where <repo> is a git repository's top
// level, found with `git`. A repo with no .worktrees/ only has tmp/ roots.
// WS_LANE_SCOPE (or WS_GAMES_ROOT) limits roots to repos inside one
// directory, for tests. Cleanup only ever matches processes by cwd under such a root, by
// ancestry, or by a subagent's own background command; never by name.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, sep } from 'node:path';

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
  const now = Date.now();
  const ps = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,etime=,tty=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const procs = new Map();
  for (const line of (ps.stdout || '').split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    procs.set(pid, { pid, ppid: Number(match[2]), start: now - etimeSeconds(match[3]) * 1000, tty: match[4], command: match[5], cwd: '' });
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
