#!/usr/bin/env node
// repo-kit's scratch folder maker (meta docs/plans/REPO-DISK-PLAN.md row DK3). One copy lives in repo-kit; every org
// repo and singleplayer carries a byte-identical copy at scripts/scratch-dir.mjs (DK8 checks the copies).
//
//   node scripts/scratch-dir.mjs <task> "<purpose>" [--row <plan-row>]
//
// creates <repo>/tmp/<task>/ and tmp/<task>/.owner, then prints the folder's absolute path. .owner is JSON: the session
// id ($CODEX_THREAD_ID, else $CLAUDE_SESSION_ID, else $CLAUDE_CODE_SESSION_ID, else $WS_LANE_NAME), the lane name, the
// herdr pane ($HERDR_PANE_ID), the start time and the purpose. DK4's SessionEnd hook removes the folders whose .owner
// names the ending session. J358 makes cleanup report-only; a human audits and copies before removal.
//
// <task> is one plain folder name: letters, digits, '.', '_' and '-', not starting with '.', never containing '/' or
// '..'. The helper deletes nothing. It refuses a folder that already exists unless that folder's .owner names this
// same session (then it prints the path again), so it never takes over another lane's or an ownerless folder.
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const TASK = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/u;

/** Why a task name is refused, or null when it is a plain folder name.
 * @param {string} task @returns {string | null} */
export function refuseTask(task) {
  if (typeof task !== 'string' || task === '') return 'a task name is required';
  if (task.includes('/') || task.includes('\\')) return `task "${task}" contains a path separator`;
  if (task.includes('..')) return `task "${task}" contains ".."`;
  if (task.length > 100) return `task "${task}" is longer than 100 characters`;
  if (!TASK.test(task)) return `task "${task}" must be letters, digits, ".", "_" and "-", not starting with "."`;
  return null;
}

/** The .owner record for a new folder.
 * @param {string} task @param {string} purpose @param {NodeJS.ProcessEnv} env @param {Date} now
 * @param {string | null} row */
export function ownerRecord(task, purpose, env, now, row = null) {
  const lane = env.WS_LANE_NAME || null;
  let receiptOffset = null;
  try { receiptOffset = statSync(env.WS_LANE_RECEIPTS ?? join(homedir(), '.cache/wildshard/lane-receipts.log')).size; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') receiptOffset = 0; }
  return {
    task,
    session: env.CODEX_THREAD_ID || env.CLAUDE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || lane,
    lane,
    pane: env.HERDR_PANE_ID || null,
    agent: env.CODEX_THREAD_ID ? 'codex' : env.CLAUDE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID ? 'claude' : lane ? 'codex' : 'unknown',
    row,
    receiptOffset,
    started: now.toISOString(),
    purpose,
  };
}

/** @param {string} path @returns {{session?: unknown} | null} */
function readOwner(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Make <root>/tmp/<task>/ and its .owner; returns the folder's absolute path. Throws on a refused name, an empty
 * purpose, or a folder that exists and is not this session's.
 * @param {string} task @param {string} purpose
 * @param {{root?: string, env?: NodeJS.ProcessEnv, now?: Date, row?: string | null}} [options] */
export function scratchDir(task, purpose, { root = ROOT, env = process.env, now = new Date(), row = null } = {}) {
  const refusal = refuseTask(task);
  if (refusal) throw new Error(refusal);
  if (typeof purpose !== 'string' || purpose.trim() === '') throw new Error('a purpose is required');
  const tmp = join(resolve(root), 'tmp');
  const dir = join(tmp, task);
  if (row !== null && !/^[A-Z][A-Z0-9-]*\d+[a-z]?$/u.test(row)) throw new Error(`row "${row}" is not a plan row`);
  const owner = ownerRecord(task, purpose.trim(), env, now, row);
  mkdirSync(tmp, { recursive: true });
  try {
    mkdirSync(dir);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    const existing = readOwner(join(dir, '.owner'));
    if (existing && owner.session && existing.session === owner.session) {
      // A lane name can outlive a task. Advance its cursor when it resumes,
      // without ever exposing a half-written ownership record.
      const next = join(dir, `.owner-${process.pid}`);
      writeFileSync(next, `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx' });
      renameSync(next, join(dir, '.owner'));
      return dir;
    }
    throw new Error(existing
      ? `${dir} already belongs to session ${String(existing.session)}; pick another task name`
      : `${dir} already exists with no .owner; pick another task name`);
  }
  try {
    writeFileSync(join(dir, '.owner'), `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    rmdirSync(dir); // only the empty folder this call just made
    throw error;
  }
  return dir;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [task = '', purpose = '', ...rest] = process.argv.slice(2);
  const rowAt = rest.indexOf('--row');
  const row = rowAt === -1 ? null : rest[rowAt + 1] ?? null;
  const other = rowAt === -1 ? rest : rest.filter((_, index) => index !== rowAt && index !== rowAt + 1);
  if (other.length > 0 || task === '--help' || task === '-h' || rowAt !== -1 && row === null) {
    console.error('usage: node scripts/scratch-dir.mjs <task> "<purpose>" [--row <plan-row>]');
    process.exit(2);
  }
  try {
    console.log(scratchDir(task, purpose, { row }));
  } catch (error) {
    console.error(`scratch-dir: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
