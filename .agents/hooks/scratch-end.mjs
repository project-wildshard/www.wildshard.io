#!/usr/bin/env node
// SessionEnd: remove on the way out (meta REPO-DISK-PLAN row DK4). When a
// session ends, every <repo>/tmp/<task>/ whose .owner (written by
// scripts/scratch-dir.mjs, DK3) names the ending session is removed, unless
// the folder holds .keep or a live process has its cwd inside it. What was
// removed and kept is appended to <repo>/tmp/.scratch.log.
//
// <repo> is this script's own checkout (two levels up), never the payload's
// cwd. The session id is the payload's session_id; Claude Code also exports
// it as $CLAUDE_CODE_SESSION_ID, which is what scratch-dir writes. A Codex
// folder carries its lane name instead, so this hook keeps it and DK6's
// 3-day sweep takes it.
//
// Deletes only when all of these hold, else keeps:
//   - <repo>/tmp is a real directory, not a symlink;
//   - tmp/<task> is a real directory (a symlink is never followed or removed);
//   - tmp/<task>/.owner is a regular file (not a symlink) of JSON whose
//     "session" equals the non-empty ending session id and whose "task", if
//     present, is the folder's name;
//   - tmp/<task>/.keep does not exist in any form;
//   - no process has its cwd inside the folder (lsof -d cwd; /proc on Linux).
//     If the process table can't be read in 700 ms, nothing is removed.
// Removal is a rename into tmp/.scratch-trash/ (instant, same volume), then a
// detached `scratch-end.mjs --purge` empties the trash: Claude Code gives
// SessionEnd hooks about 1.5 s. fs.rmSync never follows a symlink inside a
// folder: it removes the link, not its target. The next run empties any trash
// a killed purge left.
//
// Dry run: WS_SCRATCH_DRY=1 logs "would remove" and touches nothing.
// WS_SCRATCH_SYNC=1 purges inline (tests). Never fails a session: exit 0.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = realpathSync(join(dirname(SELF), '..', '..'));
const TMP = join(ROOT, 'tmp');
const TRASH = join(TMP, '.scratch-trash');
const LOG = join(TMP, '.scratch.log');

const lstat = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};
const realDir = (path) => {
  const stat = lstat(path);
  return Boolean(stat && stat.isDirectory() && !stat.isSymbolicLink());
};
const under = (path, root) => path === root || path.startsWith(root + sep);

function log(lines) {
  if (lines.length === 0) return;
  try {
    appendFileSync(LOG, lines.map((line) => `${new Date().toISOString()} ${line}\n`).join(''));
  } catch {}
}

/** Every process cwd as a real path, or null when the table can't be read. */
export function processCwds() {
  if (process.platform === 'linux') {
    const cwds = [];
    let pids;
    try {
      pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
    } catch {
      return null;
    }
    for (const pid of pids) {
      try {
        cwds.push(readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, ''));
      } catch {}
    }
    return cwds;
  }
  // A timed-out or failed lsof printed only part of the table: treat it as unreadable.
  const lsof = spawnSync('lsof', ['-nP', '-w', '-d', 'cwd', '-Fn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 700 });
  if (lsof.error || lsof.signal || lsof.status !== 0) return null;
  const cwds = (lsof.stdout || '').split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1));
  return cwds.length > 0 ? cwds : null;
}

/** The folder's .owner record, or a reason it has none that counts. */
function owner(dir) {
  const path = join(dir, '.owner');
  const stat = lstat(path);
  if (!stat) return { why: 'no .owner' };
  if (!stat.isFile()) return { why: '.owner is not a regular file' };
  if (stat.size > 64 * 1024) return { why: '.owner is too large' };
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    return record && typeof record === 'object' && !Array.isArray(record) ? { record } : { why: '.owner is not an object' };
  } catch {
    return { why: '.owner is not JSON' };
  }
}

/**
 * What to do with each tmp/<task>/ for the ending session: [{ name, action: 'remove'|'keep'|'skip', why }].
 * 'skip' is a folder that isn't this session's; 'keep' is one that is, but stays.
 */
export function plan(session, cwds) {
  if (!session || !realDir(TMP)) return [];
  const out = [];
  for (const name of readdirSync(TMP).sort()) {
    if (name.startsWith('.')) continue;
    const dir = join(TMP, name);
    if (!realDir(dir)) continue;
    const { record, why } = owner(dir);
    if (!record) {
      out.push({ name, action: 'skip', why });
      continue;
    }
    if (typeof record.session !== 'string' || record.session !== session) {
      out.push({ name, action: 'skip', why: "another session's" });
      continue;
    }
    if (record.task !== undefined && record.task !== name) {
      out.push({ name, action: 'keep', why: `.owner names task ${JSON.stringify(record.task)}` });
      continue;
    }
    if (lstat(join(dir, '.keep'))) {
      out.push({ name, action: 'keep', why: '.keep' });
      continue;
    }
    if (cwds === null) {
      out.push({ name, action: 'keep', why: 'process cwds unreadable' });
      continue;
    }
    let real = '';
    try {
      real = realpathSync(dir);
    } catch {}
    if (!real || !under(real, TMP)) {
      out.push({ name, action: 'keep', why: 'real path is not inside tmp/' });
      continue;
    }
    if (cwds.some((cwd) => under(cwd, real))) {
      out.push({ name, action: 'keep', why: 'busy: a process cwd is inside' });
      continue;
    }
    out.push({ name, action: 'remove', why: 'owned' });
  }
  return out;
}

/** Remove every entry of tmp/.scratch-trash/ (never following a symlink). */
function purge() {
  if (!realDir(TMP) || !realDir(TRASH)) return;
  let trash = '';
  try {
    trash = realpathSync(TRASH);
  } catch {}
  if (trash !== TRASH) return;
  for (const name of readdirSync(trash)) {
    try {
      rmSync(join(trash, name), { recursive: true, force: true });
    } catch {}
  }
}

function readSession() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {}
  try {
    const payload = JSON.parse(raw);
    // Session ids are uuids; anything else is refused, so it can't fake .scratch.log lines either.
    const id = typeof payload?.session_id === 'string' ? payload.session_id : '';
    return /^[\w.@:-]{1,200}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function main() {
  if (process.argv[2] === '--purge') return purge();
  const session = readSession();
  if (!session || !realDir(TMP)) return;
  const dry = process.env.WS_SCRATCH_DRY === '1';
  const steps = plan(session, processCwds());
  const lines = [];
  let moved = 0;
  for (const { name, action, why } of steps) {
    if (action === 'skip') continue;
    if (action === 'keep') {
      lines.push(`session=${session} kept tmp/${name} (${why})`);
      continue;
    }
    if (dry) {
      lines.push(`session=${session} would remove tmp/${name} (dry run)`);
      continue;
    }
    try {
      if (!realDir(TRASH)) mkdirSync(TRASH);
      if (!realDir(TRASH)) throw new Error('tmp/.scratch-trash is not a real directory');
      renameSync(join(TMP, name), join(TRASH, `${name}.${Date.now()}.${process.pid}`));
      moved++;
      lines.push(`session=${session} removed tmp/${name}`);
    } catch (error) {
      lines.push(`session=${session} kept tmp/${name} (remove failed: ${error instanceof Error ? error.message : String(error)})`);
    }
  }
  const count = (action) => steps.filter((step) => step.action === action).length;
  const kept = count('keep') + (dry ? 0 : count('remove') - moved);
  const removed = dry ? `${count('remove')} would be removed` : `${moved} removed`;
  if (steps.length > 0) lines.push(`session=${session} done: ${removed}, ${kept} kept, ${count('skip')} not this session's`);
  log(lines);
  if (dry || !realDir(TRASH)) return;
  if (process.env.WS_SCRATCH_SYNC === '1') return purge();
  try {
    spawn(process.execPath, [SELF, '--purge'], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF)) {
  try {
    main();
  } catch {}
  process.exitCode = 0;
}
