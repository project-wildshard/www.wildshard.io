import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fixtureScratch } from './owned-scratch.mjs';
import { keepCopy, oldKeepCopies } from '../../scripts/keep-copy.mjs';

const root = fixtureScratch('keep-copy-fixture');
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
