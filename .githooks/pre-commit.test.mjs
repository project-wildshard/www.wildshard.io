import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

describe('pre-commit hook', () => {
  const MSG = ok('feat: add files');
  const blocked = (result, pattern) => {
    assert.notEqual(result.status, 0, 'commit should have been blocked');
    assert.match(result.stderr, pattern);
  };

  test('prints the staged set', () => {
    const { commit } = sandbox();
    const result = commit({ 'src/a.ts': 'export const a = 1;\n' }, MSG);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /staged for THIS commit:[\s\S]*A src\/a\.ts/);
  });
  test('refuses a commit on a branch, unless ALLOW_BRANCH=1', () => {
    const { git, commit } = sandbox();
    commit({ 'a.txt': 'a\n' }, MSG);
    git(['switch', '-q', '-c', 'feature']);
    blocked(commit({ 'b.txt': 'b\n' }, MSG), /main only[\s\S]*HEAD is branch "feature", not main/);
    assert.equal(commit({ 'b.txt': 'b\n' }, MSG, { env: { ALLOW_BRANCH: '1' } }).status, 0);
  });
  test('refuses a commit on a detached HEAD', () => {
    const { git, commit } = sandbox();
    commit({ 'a.txt': 'a\n' }, MSG);
    git(['switch', '-q', '--detach']);
    blocked(commit({ 'b.txt': 'b\n' }, MSG), /HEAD is detached, not main/);
  });
  test('refuses a commit in a linked worktree', () => {
    const { root, git, commit } = sandbox();
    commit({ 'a.txt': 'a\n' }, MSG);
    const wt = `${root}-wt`;
    roots.push(wt);
    git(['worktree', 'add', '-q', '--detach', wt]);
    cpSync(join(root, '.githooks'), join(wt, '.githooks'), { recursive: true }); // tracked in the real repo
    writeFileSync(join(wt, 'b.txt'), 'b\n');
    const run = (args) => spawnSync('git', args, { cwd: wt, encoding: 'utf8', env: ENV });
    run(['add', 'b.txt']);
    const result = run(['commit', '-q', '-m', MSG]);
    assert.notEqual(result.status, 0, 'commit should have been blocked');
    assert.match(result.stderr, /linked worktree/);
  });
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}\n`).join('');
  test('a commit under 30 changed lines needs no journal entry', () => {
    const { commit } = sandbox();
    const result = commit({ 'a.txt': lines(10) }, MSG, { journal: false });
    assert.equal(result.status, 0, result.stderr);
  });
  test('a commit of 30+ changed lines requires a journal entry', () => {
    const { commit } = sandbox();
    blocked(commit({ 'a.txt': lines(40) }, MSG, { journal: false }), /changes 40 lines[\s\S]*no journal entry staged|no journal entry staged[\s\S]*changes 40 lines/);
  });
  test('deleted lines count toward the 30', () => {
    const { commit } = sandbox();
    assert.equal(commit({ 'a.txt': lines(20) }, MSG, { journal: false }).status, 0);
    blocked(commit({ 'a.txt': 'x\n', 'b.txt': lines(15) }, MSG, { journal: false }), /no journal entry staged/);
  });
  test('journal lines themselves do not count', () => {
    const { commit } = sandbox();
    const result = commit({ 'a.txt': lines(5), 'project/journal/2026-11-04-x.md': lines(40) }, MSG, { journal: false });
    assert.equal(result.status, 0, result.stderr);
  });
  test('a journal README alone does not count', () => {
    const { commit } = sandbox();
    blocked(commit({ 'a.txt': lines(40), 'project/journal/README.md': 'x\n' }, MSG, { journal: false }), /no journal entry/);
  });
  test('SKIP_JOURNAL=1 skips the journal gate', () => {
    const { commit } = sandbox();
    const result = commit({ 'a.txt': lines(40) }, MSG, { journal: false, env: { SKIP_JOURNAL: '1' } });
    assert.equal(result.status, 0, result.stderr);
  });
  test('refuses trailing whitespace', () => {
    const { commit } = sandbox();
    blocked(commit({ 'a.txt': 'a  \n' }, MSG), /whitespace/);
  });
  test('refuses a blob over 1 MB, unless ALLOW_BIG=1', () => {
    const big = { 'big.txt': 'x'.repeat(1024 * 1024 + 1) };
    blocked(sandbox().commit(big, MSG), /over the 1 MB cap/);
    assert.equal(sandbox().commit(big, MSG, { env: { ALLOW_BIG: '1' } }).status, 0);
  });
  test('refuses a credential, unless ALLOW_SECRET=1', () => {
    const leak = { 'config.ts': `export const t = '${'ghp_'}${'a1B2'.repeat(9)}';\n` };
    blocked(sandbox().commit(leak, MSG), /config\.ts:1: looks like a GitHub token/);
    assert.equal(sandbox().commit(leak, MSG, { env: { ALLOW_SECRET: '1' } }).status, 0);
  });
  test('refuses a private key', () => {
    const key = { 'id.pem': `-----BEGIN ${'OPENSSH'} PRIVATE KEY-----\nabc\n` };
    blocked(sandbox().commit(key, MSG), /private key/);
  });
  test('does not flag an env lookup', () => {
    const code = { 'gh.ts': 'const token = process.env.GITHUB_TOKEN_FOR_REPO;\n' };
    assert.equal(sandbox().commit(code, MSG).status, 0);
  });
  test('refuses broken shell and module syntax', () => {
    blocked(sandbox().commit({ 'run.sh': 'if then\n' }, MSG), /run\.sh: syntax error/);
    blocked(sandbox().commit({ 'x.mjs': 'export const = 1;\n' }, MSG), /x\.mjs: syntax error/);
  });
  test('checks the staged blob, not the working tree', () => {
    const { root, git, commit } = sandbox();
    commit({ 'run.sh': 'echo ok\n' }, MSG);
    writeFileSync(join(root, 'run.sh'), 'echo ok\nif then\n');
    git(['add', 'run.sh']);
    writeFileSync(join(root, 'run.sh'), 'echo fixed\n');
    blocked(commit({}, MSG), /run\.sh: syntax error/);
  });
  test('a pathspec commit checks only the named paths', () => {
    const { root, git, write, commit } = sandbox();
    commit({ 'a.txt': 'a\n' }, MSG);
    write('other.txt', 'someone else  \n');
    git(['add', 'other.txt']);
    write('a.txt', 'a2\n');
    write('project/journal/2026-11-04.md', '- a2\n');
    const result = git(['commit', '-q', '-m', MSG, '--', 'a.txt', 'project/journal/2026-11-04.md']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /other\.txt/);
  });
});
