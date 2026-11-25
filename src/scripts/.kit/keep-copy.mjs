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
// Meta QA 11-25 row 34: over the cap, a partial copy still keeps what is small and irreplaceable. A source or script
// file up to 1 MiB is kept; build output nested anywhere (a tmp/ clone's node_modules), captures and big files are not.
const PARTIAL_FILE_BYTES = 1024 * 1024;
const NESTED_GENERATED = /(?:^|\/)(?:node_modules|\.git|dist|coverage|\.cache|\.vite|test-results|playwright-report|blob-report)\//u;
const SOURCE = /(?:^|\/)(?:[^./]+|\.[^./]+|[^/]+\.(?:[cm]?[jt]sx?|json5?|jsonc|md|mdx|txt|sh|bash|zsh|fish|py|rb|go|rs|ya?ml|toml|ini|cfg|conf|css|scss|html?|svg|glsl|wgsl|vert|frag|sql|patch|diff|csv|tsv|xml|env))$/iu;
const PINS_LEDGER = 'out/.pins.json';
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

/** Pin mounts a worktree's own pins install published (engine scripts/pins.ts records them in out/.pins.json) are
 * declared build output: the install puts them back from the content-addressed pins. A mount changed after that install
 * (newer than the ledger) is work, and is kept. Meta QA-FEEDBACK-2026-11-24 row 48: an ended release worktree's
 * mounts under public/assets/ (music, sfx, models ...) passed 50 MiB, so keep-copy refused every one of them.
 * @param {string} root @returns {Set<string>} */
export function pinMounts(root) {
  const mounts = new Set();
  let published, installed;
  try {
    const ledger = join(root, PINS_LEDGER), info = lstatSync(ledger);
    if (!info.isFile()) return mounts;
    installed = info.mtimeMs;
    published = JSON.parse(readFileSync(ledger, 'utf8')).published;
  } catch { return mounts; }
  if (!Array.isArray(published)) return mounts;
  for (const path of published) {
    if (typeof path !== 'string' || !path.startsWith('public/') || path.split('/').some(part => part === '..' || part === '')) continue;
    try {
      const info = lstatSync(join(root, path));
      if (info.isFile() && info.mtimeMs <= installed) mounts.add(path);
    } catch { /* not published here: nothing to omit */ }
  }
  return mounts;
}

/** Include ignored evidence without walking known generated outputs or symlinks.
 * @param {string} root @param {ReadonlySet<string>} callerFiles */
function recoverableFiles(root, callerFiles) {
  const regenerableFiles = new Set([...callerFiles, ...pinMounts(root)]);
  const files = new Set(text(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(file => file && !regenerableFiles.has(file)));
  const visit = (/** @type {string} */ file) => {
    const info = lstatSync(join(root, file));
    if (info.isDirectory()) {
      for (const name of readdirSync(join(root, file))) visit(join(file, name));
    } else if (info.isFile() || info.isSymbolicLink()) { if (!regenerableFiles.has(file)) files.add(file); }
    else throw new Error(`keep-copy: cannot preserve ${file}; source must be kept`);
  };
  for (const file of text(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z']).split('\0').filter(Boolean))
    if (!REGENERABLE.test(file)) visit(file.replace(/\/$/u, ''));
  return [...files].sort();
}

/** The over-cap split (QA 11-25 row 34): small source and scripts, smallest first, up to the cap; the rest is listed,
 * never copied. A file under a nested generated folder, a capture or a file over 1 MiB is skipped.
 * @param {string} root @param {string[]} files @returns {{kept:string[],skipped:{file:string,size:number}[]}} */
export function partialSelection(root, files) {
  const sized = files.map(file => ({ file, size: lstatSync(join(root, file)).size }));
  const candidates = sized.filter(({ file, size }) => size <= PARTIAL_FILE_BYTES && !NESTED_GENERATED.test(file) && SOURCE.test(file))
    .sort((left, right) => left.size - right.size || left.file.localeCompare(right.file));
  const kept = new Set();
  let total = 0;
  for (const { file, size } of candidates) {
    if (total + size > MAX_UNTRACKED_BYTES) break;
    kept.add(file); total += size;
  }
  return { kept: [...kept].sort((left, right) => left.localeCompare(right)), skipped: sized.filter(({ file }) => !kept.has(file)) };
}

/** keepCopy over the cap: the partial copy is written and named, and removal stays refused (J358 fails closed). */
export class PartialKeepCopyError extends Error {
  /** @param {string} dir @param {object} manifest @param {string} message */
  constructor(dir, manifest, message) {
    super(message);
    this.name = 'PartialKeepCopyError';
    this.keepDir = dir;
    this.manifest = manifest;
  }
}

/** Snapshot every recoverable byte before copying and again after stopping
 * writers. Status alone misses edits within an existing untracked folder.
 * Callers may omit exact regular outputs only after verifying their current bytes.
 * @param {string} root @param {{regenerableFiles?:ReadonlySet<string>}} [options] */
export function worktreeState(root, { regenerableFiles = new Set() } = {}) {
  const hash = createHash('sha256');
  const files = recoverableFiles(root, regenerableFiles);
  // Over the cap keepCopy always refuses removal, so this snapshot never clears one: stat it, don't read gigabytes.
  const full = bytes(root, files) <= MAX_UNTRACKED_BYTES;
  for (const file of files) {
    const path = join(root, file), info = lstatSync(path);
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error(`cannot snapshot ${file}`);
    hash.update(JSON.stringify([file, info.mode, info.size, ...(full ? [] : [info.mtimeMs])]));
    if (full) hash.update(info.isSymbolicLink() ? readlinkSync(path) : readFileSync(path));
  }
  return JSON.stringify([full ? 'full' : 'over-cap',
    text(root, ['rev-parse', 'HEAD']), text(root, ['symbolic-ref', '--quiet', 'HEAD']),
    text(root, ['status', '--porcelain', '--untracked-files=all']),
    createHash('sha256').update(rawPatch(root)).digest('hex'), createHash('sha256').update(rawPatch(root, true)).digest('hex'),
    hash.digest('hex'),
  ]);
}

/** Copy recoverable Git worktree state. It never deletes or mutates `path`.
 * Over the 50 MiB cap it still writes the unpushed commits (a bundle), the patches and the small source and scripts,
 * lists the rest in SKIPPED.txt, then throws PartialKeepCopyError naming that copy, so removal stays refused.
 * Caller-verified regenerableFiles are exact paths, never directory prefixes.
 * @param {string} path @param {{keepRoot?: string, now?: Date, regenerableFiles?:ReadonlySet<string>}} [options] */
export function keepCopy(path, { keepRoot = DEFAULT_KEEP_ROOT, now = new Date(), regenerableFiles = new Set() } = {}) {
  const root = resolve(path);
  if (!existsSync(root)) throw new Error(`keep-copy: ${root} does not exist`);
  const repo = text(root, ['rev-parse', '--show-toplevel']).trim();
  const source = realpathSync(root);
  requireExternalCopy(source, physicalPath(keepRoot));
  const files = recoverableFiles(root, regenerableFiles);
  const dir = destination(root, resolve(keepRoot), now);
  mkdirSync(dir, { recursive: true });
  requireExternalCopy(source, realpathSync(dir));
  const total = bytes(root, files);
  const split = total <= MAX_UNTRACKED_BYTES ? { kept: files, skipped: [] } : partialSelection(root, files);
  /** @type {{source:string,repository:string,created:string,bundle:boolean,patch:boolean,untracked:string|{files:number,bytes:number},partial:false|{skippedFiles:number,skippedBytes:number,list:string}}} */
  const manifest = { source: root, repository: repo, created: now.toISOString(), bundle: false, patch: false, untracked: 'none', partial: false };
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
  if (split.kept.length > 0) {
    const archive = spawnSync('tar', ['-czf', join(dir, 'untracked.tgz'), '--null', '-T', '-'], { cwd: root, input: `${split.kept.join('\0')}\0`, encoding: 'utf8' });
    if (archive.status !== 0) throw new Error(`keep-copy: tar failed: ${archive.stderr.trim()}`);
    manifest.untracked = { files: split.kept.length, bytes: bytes(root, split.kept) };
  }
  if (split.skipped.length > 0) {
    const skippedBytes = split.skipped.reduce((sum, { size }) => sum + size, 0);
    writeFileSync(join(dir, 'SKIPPED.txt'), split.skipped.map(({ file, size }) => `${size}\t${file}\n`).join(''));
    manifest.partial = { skippedFiles: split.skipped.length, skippedBytes, list: 'SKIPPED.txt' };
  }
  writeFileSync(join(dir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.partial) {
    const mib = (/** @type {number} */ n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
    throw new PartialKeepCopyError(dir, manifest, `keep-copy: ${root} holds ${mib(total)} of recoverable files, over the 50 MiB cap; `
      + `partial copy saved at ${dir} (${manifest.bundle ? 'unpushed commits bundled, ' : ''}${manifest.patch ? 'tracked patch, ' : ''}`
      + `${split.kept.length} source and script file(s)); ${manifest.partial.skippedFiles} file(s), ${mib(manifest.partial.skippedBytes)}, not copied: `
      + `listed in ${join(dir, 'SKIPPED.txt')}. Removal refused: inspect those, then remove by hand and receipt it`);
  }
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
    if (!path || process.argv.length !== 3) throw new Error('usage: node src/scripts/.kit/keep-copy.mjs <worktree>');
    const result = keepCopy(path, { keepRoot: process.env.WS_SESSION_KEEP_ROOT ?? DEFAULT_KEEP_ROOT });
    process.stdout.write(`${result.dir}\n`);
  } catch (error) {
    // Exit 2: a partial copy is written and named, and removal stays refused. Exit 1: nothing was saved.
    if (error instanceof PartialKeepCopyError) process.stdout.write(`${error.keepDir}\n`);
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof PartialKeepCopyError ? 2 : 1;
  }
}
