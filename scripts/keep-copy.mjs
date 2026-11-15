#!/usr/bin/env node
// REPO-DISK DK18a/J358: preserve a worktree before a human removes it. This
// helper only writes a copy; it has no delete operation.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_UNTRACKED_BYTES = 50 * 1024 * 1024;
const DEFAULT_KEEP_ROOT = join(homedir(), '.cache/wildshard/session-keep');
const RETENTION_DAYS = 14;

/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
/** @param {string} cwd @param {string[]} args */
const text = (cwd, args) => {
  const result = run(cwd, args);
  if (result.status !== 0) throw new Error(`keep-copy: git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
};

/** @param {string} path @param {string} root @param {Date} now */
function destination(path, root, now) {
  const day = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().slice(11, 19).replaceAll(':', '-');
  return join(root, day, `${basename(path)}__${process.pid}-${stamp}-${randomUUID()}`);
}

/** @param {string} path @param {string[]} files */
function bytes(path, files) {
  return files.reduce((total, file) => total + lstatSync(join(path, file)).size, 0);
}

/** Snapshot every recoverable byte before copying and again after stopping
 * writers. Status alone misses edits within an existing untracked folder.
 * @param {string} root */
export function worktreeState(root) {
  const hash = createHash('sha256');
  for (const file of text(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    const path = join(root, file), info = lstatSync(path);
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error(`cannot snapshot ${file}`);
    hash.update(JSON.stringify([file, info.mode, info.size]));
    hash.update(info.isSymbolicLink() ? readlinkSync(path) : readFileSync(path));
  }
  return JSON.stringify([
    text(root, ['rev-parse', 'HEAD']), text(root, ['symbolic-ref', '--quiet', 'HEAD']),
    text(root, ['status', '--porcelain', '--untracked-files=all']),
    text(root, ['diff', '--binary', 'HEAD']), text(root, ['diff', '--cached', '--binary', 'HEAD']),
    hash.digest('hex'),
  ]);
}

/** Copy recoverable Git worktree state. It never deletes or mutates `path`.
 * @param {string} path @param {{keepRoot?: string, now?: Date}} [options] */
export function keepCopy(path, { keepRoot = DEFAULT_KEEP_ROOT, now = new Date() } = {}) {
  const root = resolve(path);
  if (!existsSync(root)) throw new Error(`keep-copy: ${root} does not exist`);
  const repo = text(root, ['rev-parse', '--show-toplevel']).trim();
  const files = text(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const dir = destination(root, resolve(keepRoot), now);
  mkdirSync(dir, { recursive: true });
  /** @type {{source:string,repository:string,created:string,bundle:boolean,patch:boolean,untracked:string|{files:number,bytes:number}}} */
  const manifest = { source: root, repository: repo, created: now.toISOString(), bundle: false, patch: false, untracked: 'none' };
  const unpublished = run(root, ['log', '--branches', '--tags', '--not', '--remotes', '--format=%H']);
  if (unpublished.status !== 0) throw new Error(`keep-copy: cannot inspect unpublished commits: ${unpublished.stderr.trim()}`);
  if (unpublished.stdout.trim() !== '') {
    text(root, ['bundle', 'create', join(dir, 'unpublished.bundle'), '--branches', '--tags', '--not', '--remotes']);
    manifest.bundle = true;
  }
  const patch = text(root, ['diff', '--binary', 'HEAD']);
  const indexPatch = text(root, ['diff', '--cached', '--binary', 'HEAD']);
  if (indexPatch !== '') writeFileSync(join(dir, 'index.patch'), indexPatch);
  if (patch !== '') {
    writeFileSync(join(dir, 'tracked.patch'), patch);
    manifest.patch = true;
  }
  if (files.length > 0) {
    const total = bytes(root, files);
    if (total <= MAX_UNTRACKED_BYTES) {
      const archive = spawnSync('tar', ['-czf', join(dir, 'untracked.tgz'), '--', ...files], { cwd: root, encoding: 'utf8' });
      if (archive.status !== 0) throw new Error(`keep-copy: tar failed: ${archive.stderr.trim()}`);
      manifest.untracked = { files: files.length, bytes: total };
    } else throw new Error('keep-copy: untracked files exceed 50 MiB; source must be kept');
  }
  writeFileSync(join(dir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest };
}

/** List retention candidates for a human audit. This never removes a copy.
 * @param {{keepRoot?: string, now?: Date}} [options] */
export function oldKeepCopies({ keepRoot = DEFAULT_KEEP_ROOT, now = new Date() } = {}) {
  if (!existsSync(keepRoot)) return [];
  const rows = [];
  for (const day of readdirSync(keepRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const parent = join(keepRoot, day.name);
    for (const child of readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const manifest = join(parent, child.name, 'MANIFEST.json');
      try {
        const created = new Date(JSON.parse(readFileSync(manifest, 'utf8')).created);
        const age = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
        if (Number.isFinite(age) && age >= RETENTION_DAYS) rows.push({ path: join(parent, child.name), age });
      } catch {/* Unreadable evidence is skipped. */}
    }
  }
  return rows.sort((left, right) => right.age - left.age || left.path.localeCompare(right.path));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [path] = process.argv.slice(2);
    if (!path || process.argv.length !== 3) throw new Error('usage: node scripts/keep-copy.mjs <worktree>');
    const result = keepCopy(path, { keepRoot: process.env.WS_SESSION_KEEP_ROOT ?? DEFAULT_KEEP_ROOT });
    process.stdout.write(`${result.dir}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
