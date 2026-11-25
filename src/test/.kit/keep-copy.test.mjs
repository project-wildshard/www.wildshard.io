import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as runtimeKeeper from '../../scripts/.kit/keep-copy.mjs';
import { fixtureScratch } from './owned-scratch.mjs';

// In repo-kit the kit's template keeper (files/) runs beside its runtime copy;
// a stamped repo has only its own (lean-layout L6: the test follows its script).
const TEMPLATE = new URL('../../../files/scripts/keep-copy.mjs', import.meta.url);
const RUNTIME = new URL('../../scripts/.kit/keep-copy.mjs', import.meta.url);
const keepers = { runtime: runtimeKeeper, ...(existsSync(TEMPLATE) ? { template: await import(TEMPLATE.href) } : {}) };
const root = fixtureScratch('keep-copy');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

// Meta QA 11-25 row 34 (J505), ported from engine 0ada2e9b1 and dd29fa507 by row 36: over 50 MiB keep-copy saved
// nothing, the worktree was removed by hand and a lane's update script in its ignored tmp/ was lost. Over the cap it
// now still saves the unpushed commits and the small source and scripts, names that copy, and keeps refusing removal.
const SCRIPT = 'tmp/opus-qa-play/local-update.mjs';
const put = (base, path, body) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), body); };
/** A sparse file: its size counts against the cap without using the disk. */
const big = (base, path, mib) => { put(base, path, ''); truncateSync(join(base, path), mib * 1024 * 1024); };
/** The qa-play shape: a plan worktree with an unpushed commit, a lane script and a big capture in its ignored tmp/. */
function overCap() {
  mkdirSync(root, { recursive: true });
  const base = mkdtempSync(join(root, 'partial-')), canonical = join(base, 'repo'), tree = join(base, 'tree');
  mkdirSync(canonical); git(canonical, 'init', '-q', '-b', 'main');
  put(canonical, '.gitignore', '/tmp/\n'); put(canonical, 'src/a.ts', 'export const a = 1;\n');
  git(canonical, 'add', '.gitignore', 'src/a.ts'); git(canonical, 'commit', '-qm', 'seed');
  git(canonical, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(canonical, 'worktree', 'add', '-q', '-b', 'plan/qa-play', tree);
  put(tree, 'src/a.ts', 'export const a = 2;\n'); git(tree, 'commit', '-qam', 'unpushed work');
  put(tree, SCRIPT, 'export const update = "row 7";\n');
  big(tree, 'tmp/opus-qa-play/stg-profile.cpuprofile', 60);
  put(tree, 'tmp/opus-qa-play/clone/node_modules/dep/index.js', 'module.exports = 1;\n');
  put(tree, 'src/b.ts', 'export const b = "uncommitted";\n');
  return { base, canonical, tree, keep: join(base, 'keep'), head: git(tree, 'rev-parse', 'HEAD').trim() };
}

for (const [variant, { keepCopy, oldKeepCopies, partialSelection, PartialKeepCopyError, pinMounts, worktreeState }] of Object.entries(keepers)) {
const test = (name, fn) => nodeTest(`${variant}: ${name}`, fn);
const keeperCli = fileURLToPath(variant === 'template' ? TEMPLATE : RUNTIME);

test('it saves a dirty patch that git apply restores and never removes the source', () => {
  rmSync(root, { recursive: true, force: true });
  const repo = join(root, 'repo'), keep = join(root, 'keep');
  mkdirSync(repo, { recursive: true });
  try {
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', 'a.txt'); git(repo, 'commit', '-qm', 'base');
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    git(repo, 'add', 'a.txt');
    writeFileSync(join(repo, 'a.txt'), 'changed again\n');
    writeFileSync(join(repo, 'note.txt'), 'untracked\n');
    const { dir, manifest } = keepCopy(repo, { keepRoot: keep, now: new Date('2026-11-15T19:00:00Z') });
    assert.equal(manifest.patch, true);
    assert.equal(manifest.untracked.files, 1);
    assert.ok(existsSync(join(repo, 'a.txt')));
    assert.match(readFileSync(join(dir, 'tracked.patch'), 'utf8'), /changed/u);
    git(repo, 'checkout', 'HEAD', '--', 'a.txt');
    git(repo, 'apply', join(dir, 'tracked.patch'));
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'changed again\n');
    assert.match(readFileSync(join(dir, 'index.patch'), 'utf8'), /changed/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a failed destination write leaves the source untouched', () => {
  rmSync(root, { recursive: true, force: true });
  const repo = join(root, 'repo'), blocked = join(root, 'blocked');
  mkdirSync(repo, { recursive: true });
  try {
    git(repo, 'init', '-q'); writeFileSync(join(repo, 'a.txt'), 'base\n'); git(repo, 'add', 'a.txt'); git(repo, 'commit', '-qm', 'base');
    writeFileSync(join(repo, 'a.txt'), 'changed\n'); writeFileSync(blocked, 'not a directory');
    assert.throws(() => keepCopy(repo, { keepRoot: blocked }), /EEXIST|ENOTDIR/u);
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'changed\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('it lists a 15-day keep-copy for a human without removing it', () => {
  rmSync(root, { recursive: true, force: true });
  const copy = join(root, 'keep/2026-10-31/repo__1');
  try {
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, 'MANIFEST.json'), JSON.stringify({ created: '2026-10-31T00:00:00Z' }));
    const rows = oldKeepCopies({ keepRoot: join(root, 'keep'), now: new Date('2026-11-15T00:00:00Z') });
    assert.deepEqual(rows.map(row => row.age), [15]);
    assert.ok(existsSync(copy));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a backup inside the source or through a symlink is refused before writing', () => {
  const repo = join(root, 'repo'), link = join(root, 'alias');
  mkdirSync(repo, { recursive: true });
  try {
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', 'a.txt'); git(repo, 'commit', '-qm', 'base');
    symlinkSync(repo, link);
    for (const keepRoot of [repo, join(repo, 'tmp/keep'), join(link, 'tmp/keep')])
      assert.throws(() => keepCopy(repo, { keepRoot }), /outside.*source/u);
    assert.equal(existsSync(join(repo, 'tmp')), false);
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'base\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unpublished detached HEAD can be restored from its bundle', () => {
  const repo = join(root, 'repo'), keep = join(root, 'keep'), restored = join(root, 'restored');
  mkdirSync(repo, { recursive: true });
  try {
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', 'a.txt'); git(repo, 'commit', '-qm', 'base');
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repo, 'checkout', '--detach', '-q');
    writeFileSync(join(repo, 'a.txt'), 'detached\n');
    git(repo, 'commit', '-qam', 'detached');
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    const { dir, manifest } = keepCopy(repo, { keepRoot: keep });
    assert.equal(manifest.bundle, true);
    mkdirSync(restored); git(restored, 'init', '-q');
    // Supply the published prerequisite, then fetch only the saved detached HEAD.
    git(restored, 'fetch', '-q', repo, 'refs/remotes/origin/main');
    git(restored, 'fetch', '-q', join(dir, 'unpublished.bundle'), 'HEAD');
    assert.equal(git(restored, 'rev-parse', 'FETCH_HEAD').trim(), head);
    assert.equal(git(restored, 'show', 'FETCH_HEAD:a.txt'), 'detached\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('patches restore raw bytes despite presentation and external diff settings', () => {
  const repo = join(root, 'repo'), keep = join(root, 'keep');
  mkdirSync(repo, { recursive: true });
  try {
    git(repo, 'init', '-q'); writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', 'a.txt'); git(repo, 'commit', '-qm', 'base');
    git(repo, 'config', 'color.ui', 'always');
    git(repo, 'config', 'diff.noprefix', 'true');
    git(repo, 'config', 'diff.external', 'false');
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    const { dir } = keepCopy(repo, { keepRoot: keep });
    const patch = join(dir, 'tracked.patch');
    assert.equal(readFileSync(patch, 'utf8').includes('\u001b'), false);
    git(repo, 'checkout', 'HEAD', '--', 'a.txt');
    git(repo, 'apply', patch);
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'changed\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ignored ownership and scratch evidence restore and participate in writer checks', () => {
  const repo = join(root, 'repo'), keep = join(root, 'keep'), restored = join(root, 'restored');
  mkdirSync(join(repo, 'tmp'), { recursive: true });
  try {
    git(repo, 'init', '-q'); writeFileSync(join(repo, '.gitignore'), '/tmp/\n/.owner\n');
    git(repo, 'add', '.gitignore'); git(repo, 'commit', '-qm', 'base');
    writeFileSync(join(repo, '.owner'), 'owner proof');
    writeFileSync(join(repo, 'tmp/capture.log'), 'capture proof');
    const before = worktreeState(repo);
    const { dir } = keepCopy(repo, { keepRoot: keep });
    writeFileSync(join(repo, 'tmp/capture.log'), 'shutdown proof');
    assert.notEqual(worktreeState(repo), before);
    mkdirSync(restored);
    execFileSync('tar', ['-xzf', join(dir, 'untracked.tgz'), '-C', restored]);
    assert.equal(readFileSync(join(restored, '.owner'), 'utf8'), 'owner proof');
    assert.equal(readFileSync(join(restored, 'tmp/capture.log'), 'utf8'), 'capture proof');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('text patches preserve non-UTF-8 bytes and detect byte changes', () => {
  const repo = join(root, 'repo'), keep = join(root, 'keep');
  mkdirSync(repo, { recursive: true });
  try {
    git(repo, 'init', '-q'); writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', 'a.txt'); git(repo, 'commit', '-qm', 'base');
    writeFileSync(join(repo, 'a.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 10]));
    const before = worktreeState(repo);
    const expected = Buffer.from([0x63, 0x61, 0x66, 0xf1, 10]);
    writeFileSync(join(repo, 'a.txt'), expected);
    assert.notEqual(worktreeState(repo), before);
    const { dir } = keepCopy(repo, { keepRoot: keep });
    git(repo, 'checkout', 'HEAD', '--', 'a.txt');
    git(repo, 'apply', join(dir, 'tracked.patch'));
    assert.deepEqual(readFileSync(join(repo, 'a.txt')), expected);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('caller-verified exact outputs omit only those bytes; defaults still preserve them', () => {
  const repo = join(root, 'repo'), keep = join(root, 'keep'), restored = join(root, 'restored');
  mkdirSync(join(repo, 'pins'), { recursive: true });
  try {
    git(repo, 'init', '-q'); writeFileSync(join(repo, '.gitignore'), '/pins/\n');
    git(repo, 'add', '.gitignore'); git(repo, 'commit', '-qm', 'base');
    writeFileSync(join(repo, 'pins/generated.bin'), 'verified bytes');
    writeFileSync(join(repo, 'pins/notes.txt'), 'real work');
    const policy = { regenerableFiles: new Set(['pins/generated.bin']) };
    const before = worktreeState(repo, policy);
    writeFileSync(join(repo, 'pins/notes.txt'), 'more work');
    assert.notEqual(worktreeState(repo, policy), before);
    const { dir, manifest } = keepCopy(repo, { keepRoot: keep, ...policy });
    assert.equal(manifest.untracked.files, 1);
    mkdirSync(restored);
    execFileSync('tar', ['-xzf', join(dir, 'untracked.tgz'), '-C', restored]);
    assert.equal(readFileSync(join(restored, 'pins/notes.txt'), 'utf8'), 'more work');
    assert.equal(existsSync(join(restored, 'pins/generated.bin')), false);
    assert.equal(keepCopy(repo, { keepRoot: keep }).manifest.untracked.files, 2);
    assert.equal(keepCopy(repo, { keepRoot: keep, regenerableFiles: new Set(['pins']) }).manifest.untracked.files, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// Meta QA-FEEDBACK-2026-11-24 row 48: an ended release worktree's pin mounts (over 50 MiB under public/assets/) made
// keep-copy refuse it, so the J358 copy-first removal never opened.
test('pin mounts its pins install recorded are build output; a mount changed after the install is kept', () => {
  const repo = join(root, 'repo'), keep = join(root, 'keep'), restored = join(root, 'restored');
  mkdirSync(join(repo, 'public/assets/music'), { recursive: true });
  mkdirSync(join(repo, 'out'), { recursive: true });
  try {
    git(repo, 'init', '-q'); writeFileSync(join(repo, '.gitignore'), '/public/assets/\n/out/\n');
    git(repo, 'add', '.gitignore'); git(repo, 'commit', '-qm', 'base');
    const installed = new Date('2026-11-20T00:00:00Z'), later = new Date('2026-11-21T00:00:00Z');
    writeFileSync(join(repo, 'public/assets/music/theme.ogg'), '');
    truncateSync(join(repo, 'public/assets/music/theme.ogg'), 60 * 1024 * 1024);
    writeFileSync(join(repo, 'public/assets/music/edited.ogg'), 'hand edit');
    writeFileSync(join(repo, 'public/assets/notes.txt'), 'real work');
    for (const file of ['public/assets/music/theme.ogg', 'public/assets/music/edited.ogg']) utimesSync(join(repo, file), installed, file.endsWith('edited.ogg') ? later : installed);
    writeFileSync(join(repo, 'out/.pins.json'), JSON.stringify({ revision: 'r', published: ['public/assets/music/theme.ogg', 'public/assets/music/edited.ogg', '../escape', 'public/../x'] }));
    utimesSync(join(repo, 'out/.pins.json'), installed, installed);
    assert.deepEqual([...pinMounts(repo)], ['public/assets/music/theme.ogg']);
    const { dir, manifest } = keepCopy(repo, { keepRoot: keep });
    assert.equal(manifest.untracked.files, 2);
    mkdirSync(restored);
    execFileSync('tar', ['-xzf', join(dir, 'untracked.tgz'), '-C', restored]);
    assert.equal(readFileSync(join(restored, 'public/assets/music/edited.ogg'), 'utf8'), 'hand edit');
    assert.equal(readFileSync(join(restored, 'public/assets/notes.txt'), 'utf8'), 'real work');
    assert.equal(existsSync(join(restored, 'public/assets/music/theme.ogg')), false);
    rmSync(join(repo, 'out/.pins.json'));
    assert.throws(() => keepCopy(repo, { keepRoot: keep }), error => error instanceof PartialKeepCopyError && /over the 50 MiB cap/u.test(error.message));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('over the cap: the unpushed commit and the script survive, the copy is named, and removal stays refused', () => {
  const { base, canonical, tree, keep, head } = overCap();
  try {
    const env = { ...process.env, WS_SESSION_KEEP_ROOT: keep };
    const cli = spawnSync(process.execPath, [keeperCli, tree], { env, encoding: 'utf8' });
    assert.equal(cli.status, 2, cli.stderr);
    const dir = cli.stdout.trim();
    assert.ok(dir.startsWith(join(keep, new Date().toISOString().slice(0, 10))), dir);
    assert.ok(cli.stderr.includes(`partial copy saved at ${dir}`), cli.stderr);
    assert.match(cli.stderr, /over the 50 MiB cap.*unpushed commits bundled.*Removal refused/u);
    // The unpushed commit: a fresh clone takes the published base, then the bundle's commit.
    const restored = join(base, 'restored');
    mkdirSync(restored); git(restored, 'init', '-q');
    git(restored, 'fetch', '-q', canonical, 'refs/remotes/origin/main');
    git(restored, 'fetch', '-q', join(dir, 'unpublished.bundle'), 'HEAD');
    assert.equal(git(restored, 'rev-parse', 'FETCH_HEAD').trim(), head);
    assert.equal(git(restored, 'show', 'FETCH_HEAD:src/a.ts'), 'export const a = 2;\n');
    // The script and the uncommitted source; never the capture or nested node_modules.
    const files = join(base, 'files');
    mkdirSync(files);
    execFileSync('tar', ['-xzf', join(dir, 'untracked.tgz'), '-C', files]);
    assert.equal(readFileSync(join(files, SCRIPT), 'utf8'), 'export const update = "row 7";\n');
    assert.match(readFileSync(join(files, 'src/b.ts'), 'utf8'), /uncommitted/u);
    assert.equal(existsSync(join(files, 'tmp/opus-qa-play/stg-profile.cpuprofile')), false);
    assert.equal(existsSync(join(files, 'tmp/opus-qa-play/clone/node_modules/dep/index.js')), false);
    const skipped = readFileSync(join(dir, 'SKIPPED.txt'), 'utf8');
    assert.ok(skipped.includes(`${60 * 1024 * 1024}\ttmp/opus-qa-play/stg-profile.cpuprofile\n`), skipped);
    assert.ok(skipped.includes('tmp/opus-qa-play/clone/node_modules/dep/index.js'), skipped);
    const manifest = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'));
    assert.equal(manifest.bundle, true);
    assert.equal(manifest.untracked.files, 2);
    assert.equal(manifest.partial.skippedFiles, 2);
    assert.equal(manifest.partial.list, 'SKIPPED.txt');
    // The worktree.mjs removal command chains on keep-copy: the refusal keeps the tree.
    const chained = spawnSync('sh', ['-c', `"${process.execPath}" '${keeperCli}' '${tree}' && git worktree remove '${tree}'`], { cwd: canonical, env, encoding: 'utf8' });
    assert.equal(chained.status, 2, chained.stderr);
    assert.equal(existsSync(join(tree, SCRIPT)), true);
    assert.equal(git(tree, 'rev-parse', 'HEAD').trim(), head);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('the API throws PartialKeepCopyError after writing; the over-cap snapshot is cheap and still sees edits', () => {
  const { base, tree, keep } = overCap();
  try {
    const before = worktreeState(tree);
    assert.equal(JSON.parse(before)[0], 'over-cap');
    assert.throws(() => keepCopy(tree, { keepRoot: keep }), error => error instanceof PartialKeepCopyError && existsSync(join(error.keepDir, 'untracked.tgz')));
    assert.equal(worktreeState(tree), before);
    put(tree, SCRIPT, 'export const update = "edited";\n');
    assert.notEqual(worktreeState(tree), before);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('the partial split keeps small source, smallest first, and skips captures, big files and nested installs', () => {
  const { base, tree } = overCap();
  try {
    put(tree, 'tmp/lane/shot.png', 'png'); put(tree, 'tmp/lane/run.log', 'log'); put(tree, 'tmp/lane/Makefile', 'all:');
    big(tree, 'tmp/lane/huge.json', 2); put(tree, 'tmp/lane/.owner', 'lane');
    const files = ['tmp/lane/shot.png', 'tmp/lane/run.log', 'tmp/lane/Makefile', 'tmp/lane/huge.json', 'tmp/lane/.owner', SCRIPT, 'tmp/opus-qa-play/clone/node_modules/dep/index.js'];
    const { kept, skipped } = partialSelection(tree, files);
    assert.deepEqual(kept, ['tmp/lane/.owner', 'tmp/lane/Makefile', SCRIPT]);
    assert.deepEqual(skipped.map(({ file }) => file).sort(), ['tmp/lane/huge.json', 'tmp/lane/run.log', 'tmp/lane/shot.png', 'tmp/opus-qa-play/clone/node_modules/dep/index.js']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('under the cap nothing changes: a full copy, no SKIPPED.txt, no throw', () => {
  const { base, tree, keep } = overCap();
  try {
    rmSync(join(tree, 'tmp/opus-qa-play/stg-profile.cpuprofile'));
    const { dir, manifest } = keepCopy(tree, { keepRoot: keep });
    assert.equal(manifest.partial, false);
    assert.equal(manifest.untracked.files, 3);
    assert.equal(existsSync(join(dir, 'SKIPPED.txt')), false);
    assert.equal(JSON.parse(worktreeState(tree))[0], 'full');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
}
