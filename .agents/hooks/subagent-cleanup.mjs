#!/usr/bin/env node
// SubagentStop: a finished lane leaves nothing running (meta
// MULTI-AGENT-TOOLING MA11, in the kit since REPO-KIT RK-1; Jake, 2026-11-12 ~10:45 Cancún: "I want the subagents to like not
// dangle and auto cleanup and auto stop properly").
//
// Kills, then logs to ~/.cache/wildshard/autoclean.log:
//   1. the subagent's own background shells: a Bash or Monitor command it ran
//      with run_in_background, found as `eval '<command>'` in a shell under
//      this session's claude/codex process;
//   2. every process whose cwd is inside a lane root the subagent used (its
//      worktree <repo>/.worktrees/<slug>, <repo>/.claude/worktrees/<slug>, or
//      <repo>/tmp/<lane>, <repo> found with git, so any repo, with or
//      without .worktrees/; see lib/procs.mjs), that started after the subagent
//      did and is either under this session's process or orphaned (ppid 1,
//      no terminal), e.g. a `nohup` preview server;
//   3. everything those processes started.
// Deferred while the subagent waits on its own background shell or Monitor
// (younger than WS_AUTOCLEAN_MAX_WAIT_MIN, default 45 min): it resumes and
// stops again when that ends, and cleanup runs then.
// Never kills by name, never this hook's own ancestry, never a process that
// was running before the subagent began, never one with a terminal unless it
// descends from this session.
//
// Payload (Claude Code hooks docs, 2026-11-12): cwd, agent_id, agent_type,
// agent_transcript_path (the subagent's own JSONL: per line timestamp, cwd,
// message.content[] tool_use). background_tasks is session-wide, so it is
// not used to pick shells. Under Codex, with no agent transcript, only the
// payload cwd's lane root counts. A root holding the parent session's own
// cwd is never the lane's. Linux: orphans adopted by a subreaper (systemd
// --user, tini) instead of pid 1 are not found. Never fails the session:
// always exit 0.
//
// Test seams: WS_AUTOCLEAN_SESSION_PID (the "session" process),
// WS_LANE_SCOPE (only lane roots under this directory), WS_AUTOCLEAN_LOG. Dry run: WS_AUTOCLEAN_DRY=1.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { ancestry, gitTop, isUnder, laneRoot, laneScope, log, noTerminal, short, snapshot, terminate, withDescendants } from './lib/procs.mjs';

const SLACK_MS = 1000;
// SubagentStop also fires when a subagent ends its turn to wait for its own
// background shell or Monitor (it resumes when that finishes or reports;
// seen live 2026-11-12). Cleanup is deferred while one is running and
// younger than this; it then runs at the stop after the wait.
const maxWaitMs = () => Number(process.env.WS_AUTOCLEAN_MAX_WAIT_MIN ?? 45) * 60_000;

const text = (value) => (typeof value === 'string' ? value : '');


// A path counts as the subagent's own only where the command works in it:
// `cd`, `pushd`, `mkdir`, `git worktree add`, `-C`, `--cwd`, `--root`, or an
// output redirect / `tee`. Reading another lane's log (`cat .../tmp/x/out`)
// claims nothing.
const CLAIM = /(?:\bcd|\bpushd|\bmkdir(?:\s+-p)?|\bworktree\s+add(?:\s+-b\s+\S+)?|\s-C|--cwd[=\s]|--root[=\s]|>>?|\btee(?:\s+-a)?)\s*['"]?$/;
const claimed = (command, index) => CLAIM.test(command.slice(Math.max(0, index - 60), index));

/** Lane roots a command works in: absolute or ~ paths, and tmp/<x> or .worktrees/<x> relative to cwd's repo or a repo the command names. */
export function rootsInCommand(command, cwd, base = laneScope()) {
  const roots = new Set();
  const home = homedir();
  const expanded = command.replace(/(^|[\s'"=:(])(?:~|\$HOME|\$\{HOME\})(?=\/)/g, `$1${home}`);
  const repos = new Set(cwd && laneRepo(cwd, base) ? [laneRepo(cwd, base)] : []);
  for (const match of expanded.matchAll(/\/[^\s'"`;|&<>()]+/g)) {
    // Only a path the command works in names a repo for relative tmp/<x>:
    // `cat ~/other/README; cd tmp/x` claims nothing in ~/other.
    if (!claimed(expanded, match.index)) continue;
    const repo = laneRepo(match[0], base);
    if (repo) repos.add(repo);
    const root = laneRoot(match[0], base);
    if (root) roots.add(root);
  }
  for (const match of expanded.matchAll(/(?<![\w/.~$-])(?:\.\/)?((?:\.worktrees|\.claude\/worktrees|tmp)\/[\w.@+-]+)/g)) {
    if (!claimed(expanded, match.index)) continue;
    for (const repo of repos) {
      const root = laneRoot(resolve(repo, match[1]), base);
      if (root) roots.add(root);
    }
  }
  return roots;
}

/** The git repo (work tree top level, found with git) a path is in, inside the scope if one is set, or ''. */
function laneRepo(path, base) {
  const top = gitTop(path);
  return top && (!base || top.startsWith(`${base}/`)) ? top : '';
}

/** What the subagent's transcript says it did. */
export function readTranscript(path, base = laneScope()) {
  const out = { start: 0, roots: new Set(), background: [] };
  let raw = '';
  try {
    raw = readFileSync(path.replace(/^~(?=\/)/, homedir()), 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(text(entry?.timestamp));
    if (at && (!out.start || at < out.start)) out.start = at;
    const cwd = text(entry?.cwd);
    if (laneRoot(cwd, base)) out.roots.add(laneRoot(cwd, base));
    const content = Array.isArray(entry?.message?.content) ? entry.message.content : [];
    for (const part of content) {
      if (part?.type !== 'tool_use') continue;
      const command = text(part.input?.command);
      if (!command) continue;
      for (const root of rootsInCommand(command, cwd, base)) out.roots.add(root);
      if (part.input?.run_in_background === true || part.name === 'Monitor') out.background.push(command);
    }
  }
  return out;
}

/** The nearest claude or codex process above this one. */
function sessionPid(procs) {
  const forced = Number(process.env.WS_AUTOCLEAN_SESSION_PID);
  if (forced) return forced;
  for (const pid of ancestry(procs, process.pid)) {
    const command = procs.get(pid).command;
    const argv0 = basename(command.split(' ')[0]);
    if (argv0 === 'claude' || argv0 === 'codex') return pid;
    if ((argv0 === 'node' || argv0 === 'bun') && /\/(?:claude|codex)(?:\.m?js)?(?:\s|$)/.test(command)) return pid;
  }
  return 0;
}

/** Pids to kill for one SubagentStop payload, with why. */
export function plan(payload, procs, base = laneScope()) {
  const agentPath = text(payload.agent_transcript_path);
  const transcript = agentPath ? readTranscript(agentPath, base) : null;
  const roots = new Set(transcript?.roots ?? []);
  if (laneRoot(text(payload.cwd), base)) roots.add(laneRoot(text(payload.cwd), base));
  const session = sessionPid(procs);
  // A subagent without its own worktree shares the parent session's
  // folder; that root is the session's, not the lane's.
  const sessionCwd = procs.get(session)?.cwd ?? '';
  for (const root of roots) if (sessionCwd && isUnder(sessionCwd, root)) roots.delete(root);
  const protectedPids = new Set([process.pid, ...ancestry(procs, process.pid), session]);
  const since = transcript?.start ? transcript.start - SLACK_MS : 0;
  const underSession = session ? withDescendants(procs, [session]) : new Set();
  const reasons = new Map();

  const escaped = (transcript?.background ?? []).map((command) => `eval '${command.replace(/'/g, `'\\''`)}'`);
  for (const proc of procs.values()) {
    if (protectedPids.has(proc.pid) || !underSession.has(proc.pid)) continue;
    if (since && proc.start < since) continue;
    if (escaped.some((needle) => proc.command.includes(needle))) reasons.set(proc.pid, 'background shell');
  }
  const now = Date.now();
  const waiting = [...reasons.keys()].filter((pid) => now - procs.get(pid).start < maxWaitMs());
  if (waiting.length) return { session, roots: [...roots], since, kill: [], reasons, waiting };
  for (const proc of procs.values()) {
    if (protectedPids.has(proc.pid) || reasons.has(proc.pid)) continue;
    const root = [...roots].find((candidate) => isUnder(proc.cwd, candidate));
    if (!root) continue;
    if (underSession.has(proc.pid)) {
      if (!since || proc.start >= since) reasons.set(proc.pid, `cwd in ${root}`);
    } else if (since && proc.start >= since && proc.ppid === 1 && noTerminal(proc.tty)) {
      reasons.set(proc.pid, `orphan, cwd in ${root}`);
    }
  }
  const all = withDescendants(procs, [...reasons.keys()]);
  for (const pid of protectedPids) all.delete(pid);
  for (const pid of all) if (!reasons.has(pid)) reasons.set(pid, 'child of a killed process');
  return { session, roots: [...roots], since, kill: [...all].filter((pid) => procs.has(pid)), reasons, waiting: [] };
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}') ?? {};
  } catch {
    payload = {};
  }
  const procs = snapshot();
  const result = plan(payload, procs);
  const who = `agent=${text(payload.agent_id) || '?'} type=${text(payload.agent_type) || '?'}`;
  if (!result.session) return log(`subagent-cleanup ${who}: no claude/codex session process above the hook; nothing killed`);
  if (result.waiting.length) {
    const shells = result.waiting.map((pid) => `${pid} ${short(procs.get(pid).command.replace(/^.*?eval '/, ''), 60)}`).join('; ');
    return log(`subagent-cleanup ${who}: waiting on its own background shell(s), cleanup deferred to its next stop: ${shells}`);
  }
  if (!result.kill.length) return log(`subagent-cleanup ${who}: nothing left running (roots: ${result.roots.join(', ') || 'none'})`);
  const dry = process.env.WS_AUTOCLEAN_DRY === '1';
  const gone = dry ? [] : new Set(terminate(result.kill));
  for (const pid of result.kill) {
    const proc = procs.get(pid);
    log(`subagent-cleanup ${who}: ${dry ? 'would kill' : gone.has(pid) ? 'killed' : 'FAILED to kill'} ${pid} (${result.reasons.get(pid)}) ${short(proc.command)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    main();
  } catch (error) {
    log(`subagent-cleanup: error ${short(String(error?.stack ?? error), 300)}`);
  }
  process.exit(0);
}
