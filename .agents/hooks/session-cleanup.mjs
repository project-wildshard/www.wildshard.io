#!/usr/bin/env node
// SessionEnd and SessionStart: an ended Claude Code session leaves nothing
// running (meta META-CLEAN-2 C8; ported from meta 1fcacc56, QA 11-25 row 3). On 2026-11-24 ~95 `tail -F <receipts> | ugrep`
// watch loops from an ended coordinator session were still running 14 to 17
// hours later; SubagentStop (subagent-cleanup.mjs) only sees subagents.
//
// Ownership is read from each process's environment (`ps -A -E -ww`): every
// shell Claude Code starts, and everything it spawns, carries CLAUDECODE=1,
// CLAUDE_PID (the session's claude process) and CLAUDE_CODE_SESSION_ID.
// A marked process is killed, with everything it started, when its session
// has ended:
//   SessionEnd    its CLAUDE_PID is the claude process this hook runs under
//                 and its session id is the one ending;
//   SessionStart  (and on SessionEnd too) its CLAUDE_PID is gone, or is now
//                 some other process (pid reuse), and it is older than 60 s.
//                 This catches a session that crashed or was killed, which
//                 never ran its SessionEnd.
// Never killed (listed instead): a process with no marker (Jake's own
// processes and apps); any claude or codex process, anything running under a
// live one, and anything that hosts one (herdr, its panes, iTerm); an app
// in /Applications (an app an agent opened carries the marker); a herdr
// process or anything under one that no agent session sits between; a
// process with a terminal; `--keep` and what it started (a kept world); the
// mini-1 CI runner; a land, main-push or main-watch, a kept world or phone runner,
// a launchd job (lib/procs.mjs landingSpared, keptSpared); a pid or command
// text listed in ~/.cache/wildshard/sweep-keep.txt; this hook's ancestry.
// Subagents share their session's CLAUDE_PID, so the environment cannot tell
// one subagent from another: subagent-cleanup.mjs keeps that job.
//
// A process with no readable environment (macOS hides it for platform
// binaries such as /usr/bin/tail) goes too when it shares the process group
// of a marked process that goes: Claude Code gives each command its own.
//
// Each kill is one line in ~/.cache/wildshard/cleanup.log: time, pid,
// session, why, command. Never fails or blocks the session: always exit 0.
//
//   node .agents/hooks/session-cleanup.mjs --sweep          list orphans of ended sessions
//   node .agents/hooks/session-cleanup.mjs --sweep --kill   and kill them
//
// Test seams: WS_CLEANUP_LOG, WS_SWEEP_KEEP, WS_KEPT_DIR, WS_LAUNCHD_PIDS, and
// WS_CLEANUP_MIN_AGE_MIN (default 1; a huge value turns the gone-session sweep off).
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { isAgentSession, keptSpared, landingSpared, withDescendants } from './lib/procs.mjs';

const MARKERS = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_SESSION_ID'];
const KEEP = /(?:^|\s)--keep(?:[\s=]|$)/;
const HERDR = /(?:^|\/)herdr(?:\s|$)/;
const APP = /^(?:\/System)?\/Applications\/|^\/Users\/[^/]+\/Applications\//;
const RUNNER = /\bRunner\.(?:Listener|Worker)\b|\bactions-runner\b/;
const MIN_AGE_MS = 60_000;
const cleanupLog = () => process.env.WS_CLEANUP_LOG || `${homedir()}/.cache/wildshard/cleanup.log`;
const keepFile = () => process.env.WS_SWEEP_KEEP || `${homedir()}/.cache/wildshard/sweep-keep.txt`;
const short = (text, width = 120) => (text.length > width ? `${text.slice(0, width - 3)}...` : text);

/** The marker variables in a `ps -E` line (command then environment); the last occurrence wins. */
export function parseMarkers(line) {
  const env = {};
  for (const match of line.matchAll(/(?:^|\s)(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_SESSION_ID)=(\S*)/g)) env[match[1]] = match[2];
  return env;
}

/** Every process of this machine: { pid, ppid, pgid, start, tty, command, env } (env: the marker variables only). */
export function snapshot() {
  const opts = { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 64 * 1024 * 1024, timeout: 5000 };
  const row = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.*)$/;
  const procs = new Map();
  for (const line of (spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,pgid=,lstart=,tty=,command='], opts).stdout || '').split('\n')) {
    const match = row.exec(line);
    if (!match) continue;
    const start = Date.parse(match[4]);
    if (Number.isFinite(start)) procs.set(Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), start, tty: match[5], command: match[6], env: {} });
  }
  for (const line of (spawnSync('ps', ['-A', '-E', '-ww', '-o', 'pid=,command='], opts).stdout || '').split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    const proc = match && procs.get(Number(match[1]));
    if (proc && MARKERS.some((name) => match[2].includes(`${name}=`))) proc.env = parseMarkers(match[2]);
  }
  // Linux's ps has no -E: read the markers from /proc/<pid>/environ (only our own user's processes are readable).
  if (process.platform === 'linux') for (const proc of procs.values()) proc.env = { ...proc.env, ...procEnviron(proc.pid) };
  return procs;
}

/** The marker variables of a Linux process, from /proc/<pid>/environ; {} when it is gone or not ours. */
export function procEnviron(pid, read = (path) => readFileSync(path, 'utf8')) {
  let text;
  try {
    text = read(`/proc/${pid}/environ`);
  } catch {
    return {};
  }
  return Object.fromEntries(text.split('\0').map((pair) => pair.split(/=(.*)/s)).filter(([name]) => MARKERS.includes(name)).map(([name, value]) => [name, value ?? '']));
}

/**
 * Which processes belong to an ended session, and which such processes are spared.
 * procs: Map pid -> { pid, ppid, pgid, start (ms), tty, command, env }.
 * ended: { pid, session } of the session ending now (SessionEnd), or null.
 * protect: pids never touched (the hook and its ancestry). spared: precomputed pids to spare, pid -> reason.
 * keep: pids or command fragments from sweep-keep.txt.
 * Returns { kill: [{ pid, owner, reason }], left: [{ pid, owner, reason }] }.
 */
export function select(procs, { ended = null, protect = new Set(), spared = new Map(), keep = [], now = Date.now(), minAgeMs = MIN_AGE_MS } = {}) {
  const agents = new Set([...procs.values()].filter((proc) => isAgentSession(proc.command)).map((proc) => proc.pid));
  const hosts = new Set();
  for (const pid of agents) for (let up = procs.get(pid)?.ppid; up > 1 && procs.has(up) && !hosts.has(up); up = procs.get(up).ppid) hosts.add(up);
  const liveSession = (pid, at) => agents.has(pid) && procs.get(pid).start <= at + 1000;

  /** Why a marked process's session counts as ended, or '' when it is live. */
  const endedWhy = (proc) => {
    const owner = Number(proc.env.CLAUDE_PID);
    if (ended && owner === ended.pid && (!ended.session || !proc.env.CLAUDE_CODE_SESSION_ID || proc.env.CLAUDE_CODE_SESSION_ID === ended.session)) return `its session ${ended.session || owner} ended`;
    if (!liveSession(owner, proc.start) && now - proc.start >= minAgeMs) return `its session process ${owner} is gone`;
    return '';
  };

  /** Why a process must not be killed, or ''. */
  const spareWhy = (proc) => {
    if (protect.has(proc.pid)) return 'this hook or its ancestry';
    if (agents.has(proc.pid)) return 'a claude or codex session';
    if (hosts.has(proc.pid)) return 'hosts an agent session';
    if (proc.tty !== '??' && proc.tty !== '?') return `has a terminal (${proc.tty})`;
    if (APP.test(proc.command)) return 'an app in /Applications';
    if (spared.has(proc.pid)) return spared.get(proc.pid);
    for (const item of keep) if (item && (String(proc.pid) === item || proc.command.includes(item))) return `listed in sweep-keep.txt (${item})`;
    for (let up = proc; up && up.pid > 1; up = procs.get(up.ppid)) {
      if (agents.has(up.pid)) return ended && up.pid === ended.pid ? '' : `runs under live session ${up.pid}`;
      if (KEEP.test(up.command)) return up.pid === proc.pid ? 'a --keep process' : `started by --keep process ${up.pid}`;
      if (HERDR.test(up.command)) return `herdr${up.pid === proc.pid ? '' : ` (under ${up.pid})`}`;
      if (RUNNER.test(up.command)) return 'the CI runner';
    }
    return '';
  };

  const roots = new Map();
  for (const proc of procs.values()) {
    if (proc.env.CLAUDECODE !== '1' || !/^\d+$/.test(proc.env.CLAUDE_PID ?? '')) continue;
    const why = endedWhy(proc);
    if (why) roots.set(proc.pid, { owner: Number(proc.env.CLAUDE_PID), reason: why });
  }
  // macOS hides a platform binary's environment (/usr/bin/tail, /bin/sleep), so in `tail -F log | ugrep x` only ugrep
  // shows the marker. Claude Code runs each command in its own process group: the rest of that group goes with it.
  const groups = new Map();
  for (const [pid, root] of roots) {
    const { pgid } = procs.get(pid);
    if (pgid > 1 && !groups.has(pgid) && !spareWhy(procs.get(pid))) groups.set(pgid, { pid, root });
  }
  for (const proc of procs.values()) {
    const group = groups.get(proc.pgid);
    if (group && !roots.has(proc.pid) && !proc.env.CLAUDE_PID) roots.set(proc.pid, { owner: group.root.owner, reason: `in process group ${proc.pgid} with ${group.pid}` });
  }
  const kill = [], left = [];
  const all = withDescendants(procs, [...roots.keys()]);
  for (const pid of all) {
    const proc = procs.get(pid);
    if (!proc) continue;
    let root = roots.get(pid);
    if (!root) {
      let up = proc;
      while (up && !roots.has(up.pid)) up = procs.get(up.ppid);
      root = { owner: roots.get(up?.pid)?.owner ?? 0, reason: `started by ${up?.pid}` };
    }
    const spare = spareWhy(proc);
    (spare ? left : kill).push({ pid, owner: root.owner, reason: spare ? `spared: ${spare}` : root.reason });
  }
  return { kill: kill.sort((a, b) => a.pid - b.pid), left: left.sort((a, b) => a.pid - b.pid) };
}

function log(line) {
  try {
    mkdirSync(dirname(cleanupLog()), { recursive: true });
    appendFileSync(cleanupLog(), `${new Date().toISOString().slice(0, 19)}Z ${line}\n`);
  } catch {}
}

/** The pids still running; a zombie (killed, not yet reaped by its parent) counts as gone. */
function living(pids) {
  if (!pids.length) return [];
  const ps = spawnSync('ps', ['-o', 'pid=,stat=', '-p', pids.join(',')], { encoding: 'utf8', timeout: 5000 });
  return (ps.stdout || '').split('\n').map((line) => line.trim().split(/\s+/)).filter(([pid, stat]) => pid && stat && !stat.startsWith('Z')).map(([pid]) => Number(pid));
}
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** SIGTERM, up to graceMs, then SIGKILL. Returns the pids that are gone. */
function terminate(pids, graceMs) {
  const sent = pids.filter((pid) => {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  });
  let left = living(sent);
  for (let waited = 0; waited < graceMs && left.length; waited += 100) {
    pause(100);
    left = living(left);
  }
  for (const pid of left) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  if (left.length) pause(100);
  const still = new Set(living(left));
  return new Set(sent.filter((pid) => !still.has(pid)));
}

function readKeep() {
  try {
    return readFileSync(keepFile(), 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function sparedSet(procs, stop) {
  const out = new Map();
  for (const pid of landingSpared(procs, stop)) out.set(pid, 'a land, main-push or main-watch');
  for (const pid of keptSpared(procs)) if (!out.has(pid)) out.set(pid, 'a kept world, the phone runner or a launchd job');
  return out;
}

function ancestors(procs, pid) {
  const out = new Set();
  for (let proc = procs.get(pid); proc && proc.pid > 1 && !out.has(proc.pid); proc = procs.get(proc.ppid)) out.add(proc.pid);
  return out;
}

function run({ event, session, sweep, kill }) {
  if (!sweep && event !== 'SessionEnd' && event !== 'SessionStart') return;
  const procs = snapshot();
  const protect = ancestors(procs, process.pid);
  const sessionPid = [...protect].find((pid) => isAgentSession(procs.get(pid).command)) ?? 0;
  const ended = event === 'SessionEnd' && sessionPid ? { pid: sessionPid, session } : null;
  const minAgeMs = Number(process.env.WS_CLEANUP_MIN_AGE_MIN ?? 1) * 60_000;
  const result = select(procs, { ended, protect, spared: sparedSet(procs, sessionPid), keep: readKeep(), minAgeMs });
  const describe = (item) => `${item.pid} session=${item.owner}${procs.get(item.owner) ? '' : ' (gone)'} ${item.reason}: ${short(procs.get(item.pid).command)}`;
  const tag = sweep ? 'sweep' : event;
  if (sweep && !kill) {
    for (const item of result.kill) console.log(`would kill ${describe(item)}`);
    for (const item of result.left) console.log(`left ${describe(item)}`);
    console.log(`session-cleanup: ${result.kill.length} to kill, ${result.left.length} left (dry run; --kill to kill)`);
    return;
  }
  const gone = terminate(result.kill.map((item) => item.pid), sweep ? 3000 : 700);
  for (const item of result.kill) {
    const line = `session-cleanup ${tag}: ${gone.has(item.pid) ? 'killed' : 'FAILED to kill'} ${describe(item)}`;
    log(line);
    if (sweep) console.log(line);
  }
  if (event === 'SessionEnd' || sweep) for (const item of result.left) log(`session-cleanup ${tag}: left ${describe(item)}`);
  if (sweep) console.log(`session-cleanup: ${gone.size} killed, ${result.left.length} left`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    const argv = process.argv.slice(2);
    const sweep = argv.includes('--sweep');
    let payload = {};
    if (!sweep) {
      try {
        payload = JSON.parse(readFileSync(0, 'utf8') || '{}') ?? {};
      } catch {}
    }
    const text = (value) => (typeof value === 'string' ? value : '');
    run({ event: text(payload.hook_event_name), session: text(payload.session_id), sweep, kill: argv.includes('--kill') });
  } catch (error) {
    log(`session-cleanup: error ${short(String(error?.stack ?? error), 300)}`);
  }
  process.exit(0);
}
