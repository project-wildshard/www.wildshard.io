#!/usr/bin/env node
// REPO-DISK DK17/J358: record hours during which an agent actually invokes a
// tool. A tool invocation can only happen while the Mac is awake, so sleep
// adds no entries. This helper never removes anything.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_LOG = join(homedir(), '.cache/wildshard/active-hours.log');

/** @param {Date} now */
function hour(now) {
  return Math.floor(now.getTime() / HOUR_MS);
}

/** @param {string} log */
function readings(log) {
  try {
    return new Set(readFileSync(log, 'utf8').split('\n').map(value => Number(value)).filter(value => Number.isSafeInteger(value) && value >= 0));
  } catch {
    return new Set();
  }
}

/** Append this active hour once. The parent must already exist: J358 does not
 * let a background hook invent a cache directory.
 * @param {{log?: string, now?: Date}} [options] */
export function markActiveHour({ log = DEFAULT_LOG, now = new Date() } = {}) {
  if (!existsSync(log) && !existsSync(join(log, '..'))) throw new Error(`active-hours: parent is missing for ${log}`);
  const current = hour(now), known = readings(log);
  if (known.has(current)) return false;
  appendFileSync(log, `${String(current)}\n`);
  return true;
}

/** Count distinct recorded awake/tool hours strictly after `since`.
 * @param {Date} since @param {{log?: string}} [options] */
export function activeHoursSince(since, { log = DEFAULT_LOG } = {}) {
  const after = hour(since);
  return [...readings(log)].filter(value => value > after).length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv[2] !== 'mark') throw new Error('usage: node active-hours.mjs mark');
    markActiveHour({ log: process.env.WS_ACTIVE_HOURS_LOG ?? DEFAULT_LOG });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
