#!/usr/bin/env node
// repo-kit's Vite/Vitest temp redirect and janitor. One copy lives in repo-kit; every org repo carries a byte-identical
// copy at scripts/vite-tmp.mjs, and repo-kit's test/tooling/vite-tmp-coverage.test.mjs fails when a repo's Vite or
// Vitest config does not use it or its copy drifts. Background: meta docs/plans/TEMP-HYGIENE-PLAN.md.
//
// macOS empties /private/tmp and $TMPDIR at boot, before login, and a boot with many files there hangs. Vitest 5 writes
// every transformed module under join(os.tmpdir(), nanoid()) (a 21-character folder holding client/ and ssr/), and a
// killed run never removes it. viteTmpRoot() points TMPDIR at <repo>/tmp/vitest/<pid> while the config loads, which is
// before Vitest creates either temp folder, and removes that folder when Vitest closes or the process exits.
// Run directly (`node scripts/vite-tmp.mjs [--dry-run]`) it is the janitor: dead runs' folders in tmp/vitest, the
// stale Vitest folders already in the system temp dir, and an over-size compile cache.
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOUR = 3_600_000, GIB = 1024 ** 3;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Vitest's folder name: nanoid(), 21 characters of [A-Za-z0-9_-]. */
const VITEST_FOLDER = /^[A-Za-z0-9_-]{21}$/u;
const VITEST_CHILDREN = new Set(['client', 'ssr']);

/** @param {string} path @returns {import('node:fs').Dirent[]} */
function entries(path) {
  try { return readdirSync(path, { withFileTypes: true }); } catch { return []; }
}
/** Milliseconds since a path changed; a folder another process has just removed counts as new.
 * @param {string} path @param {number} now */
export function age(path, now) {
  try { return now - lstatSync(path).mtimeMs; } catch { return 0; }
}
/** @param {number} pid */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error instanceof Error && 'code' in error && error.code === 'EPERM'; }
}
/** @param {string} path @param {boolean} dryRun */
function remove(path, dryRun) {
  if (dryRun) return true;
  try { rmSync(path, { recursive: true, force: true }); return true; } catch { return false; }
}

/** tmp/vitest/<pid> of a dead process, idle for an hour. A reused pid only delays the sweep.
 * @param {string} root @param {{now?:number,dryRun?:boolean}} [options] */
export function sweepVitestRuns(root, { now = Date.now(), dryRun = false } = {}) {
  const parent = join(root, 'tmp/vitest');
  return entries(parent).filter(row => {
    if (!row.isDirectory() || !/^[1-9][0-9]*$/u.test(row.name) || alive(Number(row.name))) return false;
    const path = join(parent, row.name);
    return age(path, now) > HOUR && remove(path, dryRun);
  }).length;
}

/** Vitest folders left in the system temp dir by runs from before the redirect, or by a config that skipped it: a
 * 21-character folder whose only children are client/ and/or ssr/, none of the three touched for an hour.
 * @param {string} directory @param {{now?:number,dryRun?:boolean}} [options] */
export function sweepSystemTemp(directory, { now = Date.now(), dryRun = false } = {}) {
  let removed = 0, files = 0;
  for (const row of entries(directory)) {
    if (!row.isDirectory() || !VITEST_FOLDER.test(row.name)) continue;
    const path = join(directory, row.name), children = entries(path);
    if (children.length === 0 || !children.every(child => child.isDirectory() && VITEST_CHILDREN.has(child.name))) continue;
    if (Math.min(age(path, now), ...children.map(child => age(join(path, child.name), now))) <= HOUR) continue;
    const count = children.reduce((sum, child) => sum + entries(join(path, child.name)).length, 0);
    if (remove(path, dryRun)) { removed++; files += count; }
  }
  return { removed, files };
}

/** Node's compile cache has no eviction. Keep a day, then cap it oldest first; a deleted entry is only a recompile.
 * @param {string} directory @param {{capBytes?:number,maxAgeMs?:number,now?:number,dryRun?:boolean}} [options] */
export function pruneCompileCache(directory, { capBytes = 4 * GIB, maxAgeMs = 24 * HOUR, now = Date.now(), dryRun = false } = {}) {
  const files = entries(directory).filter(row => row.isDirectory()).flatMap(version => {
    const parent = join(directory, version.name);
    return entries(parent).filter(row => row.isFile()).flatMap(row => {
      try {
        const path = join(parent, row.name), { mtimeMs, blocks } = lstatSync(path);
        return [{ path, mtimeMs, bytes: blocks * 512 }];
      } catch { return []; }
    });
  }).sort((a, b) => a.mtimeMs - b.mtimeMs);
  const beforeBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  let bytes = beforeBytes, removed = 0;
  for (const file of files) {
    if (now - file.mtimeMs <= maxAgeMs && bytes <= capBytes) break;
    if (remove(file.path, dryRun)) { bytes -= file.bytes; removed++; }
  }
  return { files: files.length, beforeBytes, removed, keptBytes: bytes };
}

/** A killed run never reaches its own cleanup, so a later one sweeps, detached, at most every ten minutes.
 * @param {NodeJS.ProcessEnv} env @param {string} root @param {string} janitor */
function sweepAfterKilledRuns(env, root, janitor) {
  if (env['CI'] !== undefined || env['VITEST_TMP_ROOT'] !== undefined) return;
  const stamp = join(root, 'tmp/.temp-janitor-stamp');
  try {
    if (Date.now() - statSync(stamp).mtimeMs < 600_000) return;
  } catch { /* Never swept here. */ }
  try {
    writeFileSync(stamp, '');
    spawn(process.execPath, [janitor], { detached: true, stdio: 'ignore', env: { ...env, WS_SYSTEM_TMPDIR: env['TMPDIR'] ?? tmpdir() } })
      .on('error', () => undefined).unref();
  } catch { /* Housekeeping never fails a run. */ }
}

/**
 * Point TMPDIR (and NODE_COMPILE_CACHE) at <root>/tmp/vitest/<pid>, or $VITEST_TMP_ROOT/<pid>, until cleanup().
 * Workers and their children inherit it. A second call in the same process reuses the folder and its exit handler.
 * @param {NodeJS.ProcessEnv} [env] @param {{root?:string,janitor?:string}} [options]
 */
export function temporaryRun(env = process.env, { root = ROOT, janitor = fileURLToPath(import.meta.url) } = {}) {
  const parent = env['VITEST_TMP_ROOT'] ?? join(root, 'tmp/vitest');
  mkdirSync(parent, { recursive: true });
  try { writeFileSync(join(root, 'tmp/.gitignore'), '*\n', { flag: 'wx' }); } catch { /* Already there, or root's own. */ }
  sweepAfterKilledRuns(env, root, janitor);
  const original = env['TMPDIR'], originalCompileCache = env['NODE_COMPILE_CACHE'];
  const dir = join(parent, String(process.pid));
  mkdirSync(dir, { recursive: true });
  env['TMPDIR'] = dir;
  // Workers import the cache files by their per-run path, so a shared compile cache gains an entry per module per run.
  const compileCache = join(dir, 'node-compile-cache');
  env['NODE_COMPILE_CACHE'] = compileCache;
  const cleanup = () => {
    rmSync(dir, { recursive: true, force: true });
    if (env['TMPDIR'] === dir) {
      if (original === undefined) Reflect.deleteProperty(env, 'TMPDIR');
      else env['TMPDIR'] = original;
    }
    if (env['NODE_COMPILE_CACHE'] === compileCache) {
      if (originalCompileCache === undefined) Reflect.deleteProperty(env, 'NODE_COMPILE_CACHE');
      else env['NODE_COMPILE_CACHE'] = originalCompileCache;
    }
  };
  if (env['WS_VITEST_TMP_DIR'] !== dir) {
    env['WS_VITEST_TMP_DIR'] = dir;
    process.once('exit', cleanup);
  }
  return { dir, cleanup };
}

/** The plugin every vite.config.* and vitest.config.* in an org repo lists first in `plugins`.
 * @param {{root?:string,janitor?:string}} [options] */
export function viteTmpRoot(options = {}) {
  const { cleanup } = temporaryRun(process.env, options);
  return {
    name: 'wildshard:vite-tmp-root',
    /** @param {{vitest:{onClose:(listener:()=>void)=>void}}} context */
    configureVitest({ vitest }) { vitest.onClose(cleanup); },
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dryRun = process.argv.includes('--dry-run'), cache = process.env['NODE_COMPILE_CACHE'];
  const system = process.env['WS_SYSTEM_TMPDIR'] ?? tmpdir();
  console.info(JSON.stringify({ dryRun, vitestRuns: sweepVitestRuns(ROOT, { dryRun }), systemTemp: sweepSystemTemp(system, { dryRun }),
    compileCache: cache === undefined ? null : pruneCompileCache(cache, { dryRun }) }));
}
