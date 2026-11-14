#!/usr/bin/env node
// repo-kit's 3-day scratch sweep (meta REPO-DISK-PLAN DK6, was TEMP-HYGIENE T7). One copy lives in repo-kit; every org
// repo carries a byte-identical copy at scripts/scratch-sweep.mjs, beside scratch-dir.mjs (DK3) and vite-tmp.mjs.
//
//   node scripts/scratch-sweep.mjs [--live] [--root <repo>] [--days <n>]
//
// It looks at each folder directly under <repo>/tmp/ and would remove one in which nothing (the folder or anything in
// it) changed for <n> days (3 by default), with or without a DK3 `.owner`. It keeps:
//   - a folder holding `.keep`, or named in `tmp/keep` (one name per line, `#` comments); `tmp/keep` itself when it is a
//     folder (singleplayer keeps hand-kept work there);
//   - a folder that is, or holds, some process's cwd (lsof -d cwd; /proc on Linux); an unreadable table keeps all;
//   - a folder holding a Git root with dirty files or commits no remote has (DS14's list: the reason names the root);
//   - dot folders, symlinks, and `tmp/vitest` (vite-tmp.mjs's own).
// Dry run is the default until Jake's yes (REPO-DISK decision 1) and a week of dry-run log; `--live` removes. Every
// decision is appended to tmp/.sweep.log, one line each, and a summary line goes to stdout.
import { spawnSync } from 'node:child_process';
import { appendFileSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_DAYS = 3;
const MINUTES_A_DAY = 1440;
const OWNED_ELSEWHERE = new Set(['vitest']);

/** Every process cwd as a real path, or null when the table can't be read (the same read as scratch-end.mjs). */
export function processCwds() {
  if (process.platform === 'linux') {
    let pids;
    try {
      pids = readdirSync('/proc').filter(name => /^\d+$/u.test(name));
    } catch {
      return null;
    }
    const cwds = [];
    for (const pid of pids) {
      try {
        cwds.push(readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/u, ''));
      } catch {}
    }
    return cwds;
  }
  // A timed-out or failed lsof printed only part of the table: treat it as unreadable.
  const lsof = spawnSync('lsof', ['-nP', '-w', '-d', 'cwd', '-Fn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10_000 });
  if (lsof.error || lsof.signal || lsof.status !== 0) return null;
  const cwds = (lsof.stdout || '').split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
  return cwds.length > 0 ? cwds : null;
}

/** @param {string} path */
function stat(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Names in tmp/keep. @param {string} tmp */
function keepList(tmp) {
  let text = '';
  try {
    text = readFileSync(join(tmp, 'keep'), 'utf8');
  } catch {
    return new Set();
  }
  return new Set(text.split('\n').map(line => line.replace(/#.*/u, '').trim()).filter(Boolean));
}

/** True when anything under `dir` (itself included) changed in the last `days` days, or the walk failed.
 * @param {string} dir @param {number} days */
function touched(dir, days) {
  const find = spawnSync('find', [dir, '-mmin', `-${String(days * MINUTES_A_DAY)}`, '-print', '-quit'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return find.status !== 0 || find.stdout.trim() !== '';
}

/** @param {string} root @param {readonly string[]} args */
function git(root, args) {
  // GIT_OPTIONAL_LOCKS=0: `git status` must not refresh the index, or reading a stale clone would touch it.
  const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return run.status === 0 ? run.stdout.trim() : null;
}

/** The first Git root under `dir` with dirty files or unpublished commits, and why; a Git error counts as unpublished.
 * @param {string} dir @returns {string | null} */
function unpublished(dir) {
  const find = spawnSync('find', [dir, '-maxdepth', '4', '-name', '.git', '-prune', '-print'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (find.status !== 0) return `${dir}: Git roots unreadable`;
  for (const marker of find.stdout.split('\n').filter(Boolean)) {
    const root = resolve(marker, '..');
    const status = git(root, ['status', '--porcelain', '--ignore-submodules']);
    if (status === null) return `${root}: git status failed`;
    if (status !== '') return `${root}: dirty files`;
    const ahead = git(root, ['log', '--branches', '--tags', '--not', '--remotes', '--oneline', '-1']);
    if (ahead === null) return `${root}: git log failed`;
    if (ahead !== '') return `${root}: commits no remote has`;
  }
  return null;
}

/** Each tmp/ folder and what the sweep does with it, removing nothing.
 * @param {{ root: string, days?: number, cwds?: readonly string[] | null }} options
 * @returns {{ name: string, action: 'remove' | 'keep', reason: string }[]} */
export function plan({ root, days = DEFAULT_DAYS, cwds = processCwds() }) {
  const tmp = join(root, 'tmp');
  const rows = [];
  let names = [];
  try {
    names = readdirSync(tmp).toSorted();
  } catch {
    return rows;
  }
  const kept = keepList(tmp);
  const real = cwds?.map(cwd => {
    try {
      return realpathSync(cwd);
    } catch {
      return cwd;
    }
  });
  for (const name of names) {
    const dir = join(tmp, name), info = stat(dir);
    if (info === null || !info.isDirectory() || name.startsWith('.') || OWNED_ELSEWHERE.has(name)) continue;
    const at = realpathSync(dir);
    /** @param {string} reason */
    const keep = reason => rows.push({ name, action: /** @type {const} */ ('keep'), reason });
    if (stat(join(dir, '.keep')) !== null) keep('.keep');
    else if (kept.has(name)) keep('tmp/keep');
    else if (name === 'keep') keep('tmp/keep is a folder of kept work');
    else if (real === undefined || real === null) keep('process table unreadable');
    else if (real.some(cwd => cwd === at || cwd.startsWith(at + sep))) keep('busy: a process cwd inside');
    else if (touched(dir, days)) keep(`changed within ${String(days)} days`);
    else {
      const why = unpublished(dir);
      if (why === null) rows.push({ name, action: /** @type {const} */ ('remove'), reason: `untouched ${String(days)} days` });
      else keep(`unpublished (DS14): ${why}`);
    }
  }
  return rows;
}

/** Plans, logs every row to tmp/.sweep.log, and removes the planned folders when live.
 * @param {{ root: string, live?: boolean, days?: number, cwds?: readonly string[] | null, now?: Date }} options */
export function sweep({ root, live = false, days = DEFAULT_DAYS, cwds, now = new Date() }) {
  const rows = plan({ root, days, ...(cwds === undefined ? {} : { cwds }) });
  const stamp = now.toISOString(), lines = [];
  let removed = 0;
  for (const row of rows) {
    let verb = row.action === 'keep' ? `keep (${row.reason})` : 'would remove';
    if (row.action === 'remove' && live) {
      try {
        rmSync(join(root, 'tmp', row.name), { recursive: true, force: true });
        verb = 'removed';
        removed += 1;
      } catch (error) {
        verb = `remove failed (${error instanceof Error ? error.message : String(error)})`;
      }
    }
    lines.push(`${stamp} ${verb} tmp/${row.name}${row.action === 'remove' ? ` (${row.reason})` : ''}\n`);
  }
  if (lines.length > 0) {
    try {
      appendFileSync(join(root, 'tmp/.sweep.log'), lines.join(''));
    } catch {}
  }
  const planned = rows.filter(row => row.action === 'remove').length;
  return { rows, planned, removed };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (/** @type {string} */ name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const days = Number(flag('--days') ?? DEFAULT_DAYS);
  if (!Number.isInteger(days) || days < 1) throw new Error('--days takes a whole number of days, 1 or more');
  const root = resolve(flag('--root') ?? resolve(import.meta.dirname, '..'));
  const live = args.includes('--live');
  const { rows, planned, removed } = sweep({ root, live, days });
  const keptRows = rows.filter(row => row.action === 'keep');
  process.stdout.write(`scratch-sweep ${live ? 'live' : '(dry run)'} ${root}/tmp: ${live ? `removed ${String(removed)} of ${String(planned)}` : `would remove ${String(planned)}`}, kept ${String(keptRows.length)}; log tmp/.sweep.log\n`);
}
