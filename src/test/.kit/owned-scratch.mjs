import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after } from 'node:test';
import { ownerRecord } from '../../scripts/.kit/scratch-dir.mjs';

const task = process.env.WS_LANE_NAME ?? 'codex-netlag';
const parent = resolve('tmp', task);
mkdirSync(resolve('tmp'), { recursive: true });
try {
  mkdirSync(parent);
  writeFileSync(join(parent, '.owner'), JSON.stringify(ownerRecord(task, 'disk fixtures', process.env, new Date())), { flag: 'wx' });
} catch (error) { if (error.code !== 'EEXIST') throw error; }
const owned = [];
export function fixtureScratch(name) {
  const path = mkdtempSync(join(parent, `${name}-${process.pid}-`));
  owned.push(path);
  return path;
}
after(() => { for (const path of owned) rmSync(path, { recursive: true, force: true }); });
