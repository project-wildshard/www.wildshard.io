import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

describe('pre-push hook', () => {
  const MSG = ok('feat: add files');
  const withRemote = () => {
    const box = sandbox();
    const remote = mkdtempSync(join(tmpdir(), 'repo-remote-'));
    roots.push(remote);
    spawnSync('git', ['init', '-q', '--bare', remote], { env: ENV });
    box.git(['remote', 'add', 'origin', remote]);
    box.push = (env = {}) => box.git(['push', '-q', 'origin', 'main'], env);
    return box;
  };
  const token = () => `export const t = '${'ghp_'}${'a1B2'.repeat(9)}';\n`;

  test('lets clean commits out and counts them', () => {
    const box = withRemote();
    box.commit({ 'a.txt': 'a\n' }, MSG);
    box.commit({ 'b.txt': 'b\n' }, MSG);
    const result = box.push();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /pre-push: 2 outgoing commit\(s\)/);
  });
  test('blocks a --no-verify commit that carries a token', () => {
    const box = withRemote();
    assert.notEqual(box.commit({ 'leak.ts': token() }, MSG).status, 0); // pre-commit refuses it…
    box.git(['commit', '-q', '--no-verify', '-m', MSG]); // …so force it past
    const result = box.push();
    assert.notEqual(result.status, 0, 'push should have been blocked');
    assert.match(result.stderr, /push blocked[\s\S]*leak\.ts:1: looks like a GitHub token/);
  });
  test('a new branch scans only commits that remote lacks, never another remote (J240)', () => {
    const box = withRemote();
    box.write('old.ts', token());
    box.git(['add', 'old.ts']);
    box.git(['commit', '-q', '--no-verify', '-m', MSG]);
    assert.equal(box.push({ ALLOW_SECRET: '1' }).status, 0);
    box.git(['switch', '-q', '-c', 'plan/foo']);
    box.git(['commit', '-q', '--allow-empty', '--no-verify', '-m', MSG]);
    const result = box.git(['push', '-q', 'origin', 'plan/foo']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /1 outgoing commit\(s\)/);
    const other = mkdtempSync(join(tmpdir(), 'repo-remote-'));
    roots.push(other);
    spawnSync('git', ['init', '-q', '--bare', other], { env: ENV });
    // Another remote has no tracking refs to trust: the whole history is scanned.
    box.git(['remote', 'add', 'mirror', other]);
    box.git(['fetch', '-q', 'origin']);
    const blocked = box.git(['push', '-q', 'mirror', 'plan/foo']);
    assert.notEqual(blocked.status, 0, 'origin\'s tracking refs must not exempt history from another remote');
    assert.match(blocked.stderr, /looks like a GitHub token/);
  });
  test('scans only commits the remote lacks', () => {
    const box = withRemote();
    box.write('old.ts', token());
    box.git(['add', 'old.ts']);
    box.git(['commit', '-q', '--no-verify', '-m', MSG]);
    assert.equal(box.push({ ALLOW_SECRET: '1' }).status, 0);
    box.commit({ 'new.txt': 'n\n' }, MSG);
    const result = box.push();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /1 outgoing commit\(s\)/);
  });
  test('a push that only deletes plan/* branches skips the gate; anything else keeps it (J240)', () => {
    const box = withRemote();
    box.commit({ 'a.txt': 'a\n' }, MSG);
    assert.equal(box.push().status, 0);
    for (const branch of ['plan/foo', 'plan/bar', 'feature']) {
      assert.equal(box.git(['push', '-q', 'origin', `main:refs/heads/${branch}`]).status, 0);
    }
    // From here on the push gate always fails, so only a skipped gate lets a push out.
    box.write('package.json', JSON.stringify({ scripts: { check: 'exit 1' } }));
    mkdirSync(join(box.root, 'node_modules'), { recursive: true });
    const gone = box.git(['push', '-q', 'origin', '--delete', 'plan/foo', 'plan/bar']);
    assert.equal(gone.status, 0, gone.stderr);
    assert.match(gone.stderr, /delete-only push of refs\/heads\/plan\/bar, refs\/heads\/plan\/foo: no commit leaves this machine/);
    assert.notEqual(box.git(['push', '-q', 'origin', '--delete', 'feature']).status, 0, 'a non-plan deletion keeps the gate');
    box.commit({ 'b.txt': 'b\n' }, MSG);
    const mixed = box.git(['push', '-q', 'origin', 'main', ':refs/heads/feature']);
    assert.notEqual(mixed.status, 0, 'a deletion pushed alongside an update keeps the gate');
    assert.doesNotMatch(mixed.stderr, /delete-only push/);
  });
});
