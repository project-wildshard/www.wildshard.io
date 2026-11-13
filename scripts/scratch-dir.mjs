#!/usr/bin/env node
// repo-kit's scratch folder maker (meta docs/plans/REPO-DISK-PLAN.md row DK3). One copy lives in repo-kit; every org
// repo and singleplayer carries a byte-identical copy at scripts/scratch-dir.mjs (DK8 checks the copies).
//
//   node scripts/scratch-dir.mjs <task> "<purpose>"
//
// creates <repo>/tmp/<task>/ and tmp/<task>/.owner, then prints the folder's absolute path. .owner is JSON: the session
// id ($CLAUDE_SESSION_ID, else $CLAUDE_CODE_SESSION_ID, else the Codex lane name in $WS_LANE_NAME), the lane name, the
// herdr pane ($HERDR_PANE_ID), the start time and the purpose. DK4's SessionEnd hook removes the folders whose .owner
// names the ending session; a .keep file in the folder (one line: why to keep it) stops that and DK6's 3-day sweep.
//
// <task> is one plain folder name: letters, digits, '.', '_' and '-', not starting with '.', never containing '/' or
// '..'. The helper deletes nothing. It refuses a folder that already exists unless that folder's .owner names this
// same session (then it prints the path again), so it never takes over another lane's or an ownerless folder.
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
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
 * @param {string} task @param {string} purpose @param {NodeJS.ProcessEnv} env @param {Date} now */
export function ownerRecord(task, purpose, env, now) {
  const lane = env.WS_LANE_NAME || null;
  return {
    task,
    session: env.CLAUDE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || lane,
    lane,
    pane: env.HERDR_PANE_ID || null,
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
 * @param {{root?: string, env?: NodeJS.ProcessEnv, now?: Date}} [options] */
export function scratchDir(task, purpose, { root = ROOT, env = process.env, now = new Date() } = {}) {
  const refusal = refuseTask(task);
  if (refusal) throw new Error(refusal);
  if (typeof purpose !== 'string' || purpose.trim() === '') throw new Error('a purpose is required');
  const tmp = join(resolve(root), 'tmp');
  const dir = join(tmp, task);
  const owner = ownerRecord(task, purpose.trim(), env, now);
  mkdirSync(tmp, { recursive: true });
  try {
    mkdirSync(dir);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    const existing = readOwner(join(dir, '.owner'));
    if (existing && owner.session && existing.session === owner.session) return dir;
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
  if (rest.length > 0 || task === '--help' || task === '-h') {
    console.error('usage: node scripts/scratch-dir.mjs <task> "<purpose>"');
    process.exit(2);
  }
  try {
    console.log(scratchDir(task, purpose));
  } catch (error) {
    console.error(`scratch-dir: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
