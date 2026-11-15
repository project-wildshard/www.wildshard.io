#!/usr/bin/env node
// REPO-DISK DK18b/J358: print keep-copies a human should inspect. No delete.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { oldKeepCopies } from './keep-copy.mjs';

const root = process.env.WS_SESSION_KEEP_ROOT ?? join(homedir(), '.cache/wildshard/session-keep');
const rows = oldKeepCopies({ keepRoot: root });
if (rows.length === 0) process.stdout.write('session-keep: no copies need a human retention review\n');
else for (const row of rows) process.stdout.write(`session-keep: ${row.age} d ${row.path} (human: inspect, copy if needed, then remove manually and receipt it)\n`);
