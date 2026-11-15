import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after } from 'node:test';
import { scratchDir } from '../../scripts/scratch-dir.mjs';

const task = process.env.WS_LANE_NAME ?? `test-disk-${process.pid}`;
const parent = resolve('tmp', task), existed = existsSync(parent);
scratchDir(task, 'SDK disk fixtures', { env: { ...process.env, WS_LANE_NAME: task } });
export const fixtureScratch = name => join(parent, name);
after(() => { if (!existed && readdirSync(parent).every(name => name === '.owner')) rmSync(parent, { recursive: true }); });
