#!/usr/bin/env node
// REPO-DISK DK16/J358: read liveness without changing the lane.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { activeHoursSince } from '../.agents/hooks/active-hours.mjs';

const RECEIPTS = join(homedir(), '.cache/wildshard/lane-receipts.log');
/** @param {string} path @param {string} root */
const under = (path, root) => path === root || path.startsWith(root + sep);
/** @param {string} path */
const readOwner = path => {
  try {
    const marker = join(path, '.owner'), info = lstatSync(marker);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) return undefined;
    const value = JSON.parse(readFileSync(marker, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch { return undefined; }
};

/** null means process evidence could not be read; callers protect the folder. */
export function processCwds() {
  if (existsSync('/proc/self/cwd')) {
    try {
      return readdirSync('/proc').filter(pid => /^\d+$/u.test(pid)).flatMap(pid => {
        try { return [readlinkSync(`/proc/${  pid  }/cwd`)]; } catch { return []; }
      });
    } catch { return null; }
  }
  const found = spawnSync('lsof', ['-nP', '-w', '-d', 'cwd', '-Fn'], {
    cwd: '/', encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024 * 1024,
  });
  if (found.error || found.signal || found.status !== 0) return null;
  return found.stdout.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
}

/** @param {unknown} lane @param {string} path @param {unknown} offset */
function receipt(lane, path, offset) {
  if (typeof lane !== 'string' || !/^[\w.-]+$/u.test(lane)) return undefined;
  // Undated receipts cannot end a folder created later. Legacy owners have
  // no cursor, so they must use process/session evidence and active hours.
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return undefined;
  try {
    const log = readFileSync(path);
    if (offset > log.length) return undefined;
    let last;
    for (const line of log.subarray(offset).toString('utf8').split('\n').slice(0, -1))
      if (line.includes(` ${lane} `) && /\s(?:DONE|ENDED|PAUSED):/u.test(line)) last = line;
    return last;
  } catch { return undefined; }
}

/** @param {string} root @param {number} depth */
function pidfileLive(root, depth = 0) {
  for (const name of ['.pid', 'pid', 'pidfile', 'server.pid', 'dev.pid']) {
    try {
      const pid = Number(readFileSync(join(root, name), 'utf8').trim());
      if (!Number.isSafeInteger(pid) || pid < 1) continue;
      try { process.kill(pid, 0); return true; } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EPERM') return true; }
    } catch {/* Unreadable evidence is skipped. */}
  }
  if (depth < 2) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith('dev-') &&
          pidfileLive(join(root, entry.name), depth + 1)) return true;
      }
    } catch {/* No readable dev-process children. */}
  }
  return false;
}

/** @param {unknown} session @param {string|undefined} activeLog
 * @returns {{live?:boolean,latest?:number}} */
function sessionEvidence(session, activeLog) {
  if (typeof session !== 'string' || !/^[\w.@:-]+$/u.test(session)) return {};
  // A transcript's existence is not liveness: use its most recent write.
  let latest = 0;
  for (const root of [join(homedir(), '.claude/projects'), join(homedir(), '.codex/sessions')]) {
    try {
      for (const row of readdirSync(root, { recursive: true })) {
        if (!String(row).includes(session)) continue;
        const info = statSync(join(root, String(row)));
        if (info.isFile()) latest = Math.max(latest, info.mtimeMs);
      }
    } catch {/* Unreadable evidence is skipped. */}
  }
  const listed = spawnSync('herdr', ['agent', 'list'], { encoding: 'utf8', timeout: 2000, maxBuffer: 8 * 1024 * 1024 });
  if (listed.status === 0) {
    try {
      /** @type {{agent_session?:{value?:string}}[]} */
      const agents = JSON.parse(listed.stdout)?.result?.agents ?? [];
      if (agents.some(agent => agent.agent_session?.value === session)) return { live: true };
    } catch {/* Unreadable evidence is skipped. */}
  }
  return { live: latest > 0 && activeHoursSince(new Date(latest), { log: activeLog }) < 24, latest };
}

/** Read-only classification. Unreadable process evidence always protects a folder.
 * @param {string} path
 * @param {{receipts?:string,activeHours?:number,cwdLive?:boolean,cwds?:string[]|null,sessionLive?:boolean,activeLog?:string}} [options] */
export function laneLive(path, { receipts = RECEIPTS, activeHours, cwdLive, cwds,
  sessionLive, activeLog = process.env.WS_ACTIVE_HOURS_LOG } = {}) {
  let root;
  try { root = realpathSync(path); } catch { return { state: 'unknown', reason: 'folder unreadable' }; }
  const directories = cwds === undefined && cwdLive === undefined ? processCwds() : cwds;
  if (cwdLive === true || directories?.some(cwd => under(cwd, root)) || pidfileLive(root))
    return { state: 'live', reason: 'a process cwd or pidfile is live' };
  if (cwdLive === undefined && directories === null) return { state: 'live', reason: 'process evidence unreadable' };
  const record = readOwner(root);
  if (!record) {
    const hours = activeHours ?? activeHoursSince(lstatSync(root).mtime, { log: activeLog });
    return { state: 'unknown', reason: hours >= 72 ? 'no readable .owner; at least 72 active hours, investigate' : 'no readable .owner' };
  }
  const evidence = sessionLive === undefined ? sessionEvidence(record.session, activeLog) : { live: sessionLive, latest: 0 };
  if (evidence.live) return { state: 'live', reason: 'owner session is present' };
  const line = receipt(record.lane, receipts, record.receiptOffset);
  if (line && /\s(?:DONE|ENDED):/u.test(line)) return { state: 'ended', reason: 'ending receipt' };
  const since = evidence.latest !== undefined && evidence.latest > 0 ? evidence.latest : Date.parse(record.started ?? record.created ?? '');
  const elapsed = activeHours ?? (Number.isFinite(since) ? activeHoursSince(new Date(since), { log: activeLog }) : 0);
  if (elapsed >= 24) return { state: 'ended', reason: 'owner gone and silent for 24 active hours' };
  return { state: 'live', reason: line ? 'non-ending receipt' : 'no ending receipt' };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [path] = process.argv.slice(2);
  if (!path || process.argv.length !== 3) {
    process.stderr.write('usage: node scripts/lane-live.mjs <lane-root>\n');
    process.exitCode = 2;
  } else {
    const result = laneLive(path, { receipts: process.env.WS_LANE_RECEIPTS ?? RECEIPTS });
    process.stdout.write(`${result.state  }: ${  result.reason  }\n`);
  }
}
