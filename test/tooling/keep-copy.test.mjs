import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { keepCopy, oldKeepCopies, worktreeState } from '../../scripts/keep-copy.mjs';

mkdirSync('tmp/codex-netlag', { recursive: true });
const root = mkdtempSync(resolve('tmp/codex-netlag/keep-copy-'));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

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
