import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
    blocked(commit({ 'b.txt': 'b\n' }, MSG), /canonical checkout[\s\S]*HEAD is branch "feature", not main/);
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
  // J221/J240 (DEV-SPEED DS6): <repo>/.worktrees/<slug> on plan/<slug> may commit.
  const planWorktree = (slug, branch) => {
    const { root, git, commit } = sandbox();
    commit({ 'a.txt': 'a\n' }, MSG);
    const wt = join(root, '.worktrees', slug);
    git(['worktree', 'add', '-q', '-b', branch, wt]);
    cpSync(join(root, '.githooks'), join(wt, '.githooks'), { recursive: true }); // tracked in the real repo
    const run = (args, env = {}) => spawnSync('git', args, { cwd: wt, encoding: 'utf8', env: { ...ENV, ...env } });
    const write = (path, text) => { writeFileSync(join(wt, path), text); run(['add', path]); };
    return { root, git, wt, run, write };
  };
  test('a plan worktree commits on its own plan branch', () => {
    const { run, write } = planWorktree('foo', 'plan/foo');
    write('b.txt', 'b\n');
    const result = run(['commit', '-q', '-m', MSG]);
    assert.equal(result.status, 0, result.stderr);
  });
  test('a plan worktree refuses another branch or a detached HEAD', () => {
    const { run, write } = planWorktree('foo', 'plan/bar');
    write('b.txt', 'b\n');
    blocked(run(['commit', '-q', '-m', MSG]), /HEAD is branch "plan\/bar", not plan\/foo/);
    run(['switch', '-q', '--detach']);
    write('c.txt', 'c\n');
    blocked(run(['commit', '-q', '-m', MSG]), /HEAD is detached, not plan\/foo/);
  });
  test('the canonical checkout refuses a plan branch, unless ALLOW_BRANCH=1', () => {
    const { git, commit } = sandbox();
    commit({ 'a.txt': 'a\n' }, MSG);
    git(['switch', '-q', '-c', 'plan/foo']);
    blocked(commit({ 'b.txt': 'b\n' }, MSG), /HEAD is branch "plan\/foo", not main/);
  });
  test('a rebase inside a plan worktree must be of its own plan branch', () => {
    const { run, write, wt } = planWorktree('foo', 'plan/foo');
    write('b.txt', 'b\n');
    assert.equal(run(['commit', '-q', '-m', MSG]).status, 0);
    run(['branch', 'plan/bar']);
    // A rebase of plan/bar stopped for edit inside .worktrees/foo may not commit there.
    const rebasing = run(['rebase', '-q', '--exec', 'false', 'HEAD~1', 'plan/bar'], { GIT_EDITOR: 'true' });
    assert.notEqual(rebasing.status, 0, 'the exec step stops the rebase');
    writeFileSync(join(wt, 'c.txt'), 'c\n');
    run(['add', 'c.txt']);
    blocked(run(['commit', '-q', '-m', MSG]), /a rebase of refs\/heads\/plan\/bar, not plan\/foo/);
    run(['rebase', '--abort']);
  });
  test('a separate Git dir never makes its parent folder a canonical checkout', () => {
    const { root, git, commit } = sandbox();
    commit({ 'a.txt': 'a\n' }, MSG);
    // Move the Git dir out of the checkout: <root>/.git becomes a gitfile.
    const store = `${root}-store`;
    roots.push(store);
    git(['init', '-q', `--separate-git-dir=${store}`]);
    // A worktree placed under the store's parent folder is not the canonical checkout's .worktrees/.
    const fake = join(dirname(store), '.worktrees', 'foo');
    roots.push(join(dirname(store), '.worktrees'));
    git(['worktree', 'add', '-q', '-b', 'plan/foo', fake]);
    cpSync(join(root, '.githooks'), join(fake, '.githooks'), { recursive: true });
    writeFileSync(join(fake, 'b.txt'), 'b\n');
    const run = (args) => spawnSync('git', args, { cwd: fake, encoding: 'utf8', env: ENV });
    run(['add', 'b.txt']);
    blocked(run(['commit', '-q', '-m', MSG]), /is not <repo>\/\.worktrees\/<slug>/);
  });
  test('a worktree nested deeper than .worktrees/<slug> is refused', () => {
    const { run, write } = planWorktree('foo/deeper', 'plan/foo');
    write('b.txt', 'b\n');
    blocked(run(['commit', '-q', '-m', MSG]), /is not <repo>\/\.worktrees\/<slug>/);
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
