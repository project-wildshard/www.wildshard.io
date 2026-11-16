#!/usr/bin/env node
// REPO-DISK DK18a/J358: preserve a worktree before a human removes it. This
// helper only writes a copy; it has no delete operation.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_UNTRACKED_BYTES = 50 * 1024 * 1024;
const DEFAULT_KEEP_ROOT = join(homedir(), '.cache/wildshard/session-keep');
const RETENTION_DAYS = 14;
const RAW_PATCH = ['--binary', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];
// Declared build/install outputs are regenerable. Other ignored files, including
// tmp captures and owner metadata, must be copied or make removal fail closed.
const REGENERABLE = /^(?:(?:node_modules|dist(?:-[^/]+)?|out|build|coverage|\.bin-deps|\.tsc-layers|\.cache|\.vite|test-results|playwright-report|blob-report)\/|public\/(?:assets\/(?:packs|physics|gpu)|basis|shardfiles)\/)|(?:^|\/)[^/]+\.(?:tsbuildinfo|generated\.ts)$/u;

/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
/** @param {string} cwd @param {string[]} args */
const text = (cwd, args) => {
  const result = run(cwd, args);
  if (result.status !== 0) throw new Error(`keep-copy: git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
};

/** A patch is a byte stream: text diffs may contain non-UTF-8 source bytes.
 * @param {string} root @param {boolean} [cached] */
function rawPatch(root, cached = false) {
  const args = ['-C', root, 'diff', ...(cached ? ['--cached'] : []), ...RAW_PATCH, 'HEAD'];
  const result = spawnSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`keep-copy: raw patch failed: ${result.stderr?.toString('utf8')}`);
  return result.stdout;
}

/** @param {string} path @param {string} root @param {Date} now */
function destination(path, root, now) {
  const day = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().slice(11, 19).replaceAll(':', '-');
  return join(root, day, `${basename(path)}__${process.pid}-${stamp}-${randomUUID()}`);
}

/** Resolve existing symlink ancestors before any destination directory is made.
 * @param {string} path */
function physicalPath(path) {
  let ancestor = resolve(path);
  const tail = [];
  while (!existsSync(ancestor)) {
    tail.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return resolve(realpathSync(ancestor), ...tail);
}

/** @param {string} source @param {string} target */
function requireExternalCopy(source, target) {
  if (target === source || target.startsWith(source + sep))
    throw new Error('keep-copy: destination must stay outside the source removal tree');
}

/** @param {string} path @param {string[]} files */
function bytes(path, files) {
  return files.reduce((total, file) => total + lstatSync(join(path, file)).size, 0);
}

/** Include ignored evidence without walking known generated outputs or symlinks.
 * @param {string} root */
function recoverableFiles(root) {
  const files = new Set(text(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean));
  const visit = (/** @type {string} */ file) => {
    const info = lstatSync(join(root, file));
    if (info.isDirectory()) {
      for (const name of readdirSync(join(root, file))) visit(join(file, name));
    } else if (info.isFile() || info.isSymbolicLink()) files.add(file);
    else throw new Error(`keep-copy: cannot preserve ${file}; source must be kept`);
  };
  for (const file of text(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z']).split('\0').filter(Boolean))
    if (!REGENERABLE.test(file)) visit(file.replace(/\/$/u, ''));
  const list = [...files].sort();
  if (bytes(root, list) > MAX_UNTRACKED_BYTES) throw new Error('keep-copy: recoverable files exceed 50 MiB; source must be kept');
  return list;
}

/** Snapshot every recoverable byte before copying and again after stopping
 * writers. Status alone misses edits within an existing untracked folder.
 * @param {string} root */
export function worktreeState(root) {
  const hash = createHash('sha256');
  for (const file of recoverableFiles(root)) {
    const path = join(root, file), info = lstatSync(path);
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error(`cannot snapshot ${file}`);
    hash.update(JSON.stringify([file, info.mode, info.size]));
    hash.update(info.isSymbolicLink() ? readlinkSync(path) : readFileSync(path));
  }
  return JSON.stringify([
    text(root, ['rev-parse', 'HEAD']), text(root, ['symbolic-ref', '--quiet', 'HEAD']),
    text(root, ['status', '--porcelain', '--untracked-files=all']),
    createHash('sha256').update(rawPatch(root)).digest('hex'), createHash('sha256').update(rawPatch(root, true)).digest('hex'),
    hash.digest('hex'),
  ]);
}

/** Copy recoverable Git worktree state. It never deletes or mutates `path`.
 * @param {string} path @param {{keepRoot?: string, now?: Date}} [options] */
export function keepCopy(path, { keepRoot = DEFAULT_KEEP_ROOT, now = new Date() } = {}) {
  const root = resolve(path);
  if (!existsSync(root)) throw new Error(`keep-copy: ${root} does not exist`);
  const repo = text(root, ['rev-parse', '--show-toplevel']).trim();
  const source = realpathSync(root);
  requireExternalCopy(source, physicalPath(keepRoot));
  const files = recoverableFiles(root);
  const dir = destination(root, resolve(keepRoot), now);
  mkdirSync(dir, { recursive: true });
  requireExternalCopy(source, realpathSync(dir));
  /** @type {{source:string,repository:string,created:string,bundle:boolean,patch:boolean,untracked:string|{files:number,bytes:number}}} */
  const manifest = { source: root, repository: repo, created: now.toISOString(), bundle: false, patch: false, untracked: 'none' };
  const unpublished = run(root, ['log', 'HEAD', '--branches', '--tags', '--not', '--remotes', '--format=%H']);
  if (unpublished.status !== 0) throw new Error(`keep-copy: cannot inspect unpublished commits: ${unpublished.stderr.trim()}`);
  if (unpublished.stdout.trim() !== '') {
    text(root, ['bundle', 'create', join(dir, 'unpublished.bundle'), 'HEAD', '--branches', '--tags', '--not', '--remotes']);
    manifest.bundle = true;
  }
  const patch = rawPatch(root);
  const indexPatch = rawPatch(root, true);
  if (indexPatch.length > 0) writeFileSync(join(dir, 'index.patch'), indexPatch);
  if (patch.length > 0) {
    writeFileSync(join(dir, 'tracked.patch'), patch);
    manifest.patch = true;
  }
  if (files.length > 0) {
    const total = bytes(root, files);
    if (total <= MAX_UNTRACKED_BYTES) {
      const archive = spawnSync('tar', ['-czf', join(dir, 'untracked.tgz'), '--null', '-T', '-'], { cwd: root, input: `${files.join('\0')}\0`, encoding: 'utf8' });
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
