import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
});
