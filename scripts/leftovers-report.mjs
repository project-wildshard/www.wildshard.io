#!/usr/bin/env node
// REPO-DISK J358: a read-only, compact leftovers list for the session brief and
// daily human audit. It deliberately has no delete operation.
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { laneLive } from './lane-live.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RECEIPTS = join(homedir(), '.cache/wildshard/lane-receipts.log');

/** @param {string} path */
function size(path) {
  try { return Number.parseInt(execFileSync('du', ['-sk', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/u)[0] ?? '0', 10); } catch { return 0; }
}

/** Read each direct tmp folder without mutating it.
 * @param {{root?: string, receipts?: string}} [options] */
export function leftovers({ root = ROOT, receipts = RECEIPTS } = {}) {
  const tmp = join(resolve(root), 'tmp');
  let names = [];
  try { names = readdirSync(tmp).sort(); } catch { return []; }
  return names.flatMap(name => {
    const path = join(tmp, name);
    try { if (!lstatSync(path).isDirectory() || name.startsWith('.')) return []; } catch { return []; }
    const liveness = laneLive(path, { receipts });
    return [{ name, path, state: liveness.state, reason: liveness.reason, kib: size(path) }];
  });
}

/** At most four brief lines. @param {ReturnType<typeof leftovers>} rows */
export function brief(rows) {
  if (rows.length === 0) return ['  leftovers: none'];
  return [...rows].sort((a, b) => {
    const state = a.state.localeCompare(b.state), byteOrder = b.kib - a.kib;
    return state !== 0 ? state : byteOrder !== 0 ? byteOrder : a.name.localeCompare(b.name);
  }).slice(0, 4)
    .map(row => `  ${row.state}: tmp/${row.name} (${(row.kib / 1024 / 1024).toFixed(1)} GiB; ${row.reason})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const rootAt = process.argv.indexOf('--root');
  const root = rootAt === -1 ? ROOT : resolve(process.argv[rootAt + 1] ?? '');
  process.stdout.write(`${brief(leftovers({ root, receipts: process.env.WS_LANE_RECEIPTS ?? RECEIPTS })).join('\n')}\n`);
}
