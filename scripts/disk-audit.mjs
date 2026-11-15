#!/usr/bin/env node
// J358/DK22: daily agent audit input. Read-only; no deletion or process stops.
import { resolve } from 'node:path';
import { leftovers } from './leftovers-report.mjs';
import { oldKeepCopies } from './keep-copy.mjs';

const args = process.argv.slice(2);
const roots = [];
for (let index = 0; index < args.length; index += 2) {
  if (args[index] !== '--root' || !args[index + 1]) throw new Error('usage: node scripts/disk-audit.mjs [--root <repo>]...');
  roots.push(resolve(args[index + 1]));
}
if (roots.length === 0) roots.push(resolve(import.meta.dirname, '..'));
for (const root of roots) {
  const rows = leftovers({ root });
  const counts = Object.fromEntries(['ended', 'live', 'unknown'].map(state => [state, rows.filter(row => row.state === state).length]));
  process.stdout.write(JSON.stringify({ root, counts, rows }) + '\n');
}
process.stdout.write(JSON.stringify({ retention: oldKeepCopies({ keepRoot: process.env.WS_SESSION_KEEP_ROOT }) }) + '\n');
