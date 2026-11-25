import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './check-commit-message.mjs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ENV, TRAILER, ok, sandbox } from './test-helpers.mjs';

describe('commit message', () => {
  test('accepts a well-formed AI commit', () => {
    assert.equal(validate(ok('feat(queue): group layers by stack')), null);
  });
  test('accepts a subject + trailer with no body', () => {
    assert.equal(validate(`fix: handle empty diff\n\n${TRAILER}\n`), null);
  });
  test('accepts other trailers next to Assisted-by', () => {
    assert.equal(validate(`fix: x\n\nBody.\n\nRefs: #12\n${TRAILER}\n`), null);
  });
  test('ignores comments and the commit -v scissors section', () => {
    const msg = `${ok('docs: note')}# comment\n# ------------------------ >8 ------------------------\n${'x'.repeat(200)}\n`;
    assert.equal(validate(msg), null);
  });
  test('refuses a non-conventional subject', () => {
    assert.match(validate(ok('Add the queue')), /Conventional Commits/);
  });
  test('refuses an unknown type', () => {
    assert.match(validate(ok('feature: add queue')), /Conventional Commits/);
  });
  test('refuses a subject over 50 characters', () => {
    assert.match(validate(ok(`feat: ${'a'.repeat(45)}`)), /at most 50/);
  });
  test('counts graphemes, not bytes', () => {
    assert.equal(validate(ok(`docs: ${'é'.repeat(44)}`)), null);
  });
  test('refuses a trailing period', () => {
    assert.match(validate(ok('fix: handle empty diff.')), /period/);
  });
  test('refuses a missing blank line after the subject', () => {
    assert.match(validate(`fix: x\nbody\n\n${TRAILER}\n`), /blank line/);
  });
  test('refuses a body line over 72 characters', () => {
    assert.match(validate(ok('fix: x', 'word '.repeat(16))), /72/);
  });
  test('allows a lone long URL in the body', () => {
    assert.equal(validate(ok('fix: x', `https://example.com/${'a'.repeat(80)}`)), null);
  });
  test('refuses a missing trailer', () => {
    assert.match(validate('fix: x\n\nBody.\n'), /Assisted-by/);
  });
  test('SKIP_ATTRIB drops only the trailer requirement', () => {
    assert.equal(validate('fix: x\n\nBody.\n', { human: true }), null);
    assert.match(validate('Add the queue\n', { human: true }), /Conventional/);
  });
  test('refuses Co-Authored-By for an AI', () => {
    const msg = `fix: x\n\nBody.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n${TRAILER}\n`;
    assert.match(validate(msg), /Co-Authored-By/);
  });
  test('allows Co-Authored-By for a human', () => {
    assert.equal(validate(`fix: x\n\nBody.\n\nCo-authored-by: Ada <ada@example.com>\n${TRAILER}\n`), null);
  });
  test('refuses an AI banner', () => {
    assert.match(validate(ok('fix: x', '🤖 Generated with [Claude Code](https://claude.com)')), /banner/);
  });
  test('refuses a placeholder model', () => {
    assert.match(validate('fix: x\n\nBody.\n\nAssisted-by: Claude:unknown\n'), /real model/);
  });
  test('accepts Claude:<model> and Codex:<model>', () => {
    assert.equal(validate('fix: x\n\nBody.\n\nAssisted-by: Claude:claude-opus-5-5\n'), null);
    assert.equal(validate('fix: x\n\nBody.\n\nAssisted-by: Codex:gpt-6.2-sol\n'), null);
  });
  test('refuses any other agent name, and names the accepted form', () => {
    for (const name of ['Claude Code', 'Claude-Code', 'claude-code', 'claude', 'codex', 'Cursor', 'Claude Opus']) {
      const error = validate(`fix: x\n\nBody.\n\nAssisted-by: ${name}:claude-opus-5-5\n`);
      assert.match(error ?? '', /Assisted-by: Claude:<model> or Assisted-by: Codex:<model>/, name);
    }
  });
  test('a missing trailer names the accepted form', () => {
    assert.match(validate('fix: x\n\nBody.\n'), /Assisted-by: Claude:<model>/);
  });
  test('refuses a trailer that is not in the final block', () => {
    assert.match(validate(`fix: x\n\n${TRAILER}\n\nMore body.\n`), /final trailer block/);
  });
  test('refuses a trailer glued to the body', () => {
    assert.match(validate(`fix: x\n\nBody.\n${TRAILER}\n`), /final trailer block/);
  });
  test('refuses two Assisted-by trailers', () => {
    assert.match(validate(`fix: x\n\nBody.\n\n${TRAILER}\n${TRAILER}\n`), /exactly one/);
  });
  test('skips git-generated messages', () => {
    assert.equal(validate("Merge branch 'main' of github.com:x/y\n"), null);
    assert.equal(validate('Revert "feat: x"\n\nThis reverts commit abc.\n'), null);
    assert.equal(validate('fixup! feat: x\n'), null);
  });
});

describe('commit-msg hook', () => {
  test('lets a good commit through', () => {
    const { commit } = sandbox();
    const result = commit({ 'a.txt': 'a\n' }, ok('feat: add a'));
    assert.equal(result.status, 0, result.stderr);
  });
  test('blocks a bad message and explains why', () => {
    const { commit } = sandbox();
    const result = commit({ 'a.txt': 'a\n' }, 'add a');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /commit blocked: Use a Conventional Commits subject/);
  });
  test('SKIP_ATTRIB=1 lets a human commit without a trailer', () => {
    const { commit } = sandbox();
    const result = commit({ 'a.txt': 'a\n' }, 'feat: add a\n\nBy hand; SKIP_ATTRIB=1 since no agent wrote any of it.', { env: { SKIP_ATTRIB: '1' } });
    assert.equal(result.status, 0, result.stderr);
  });
  // J381, meta QA 11-25 row 51: an escape hatch is named with its reason.
  test('a commit made with a SKIP_ or ALLOW_ variable set is refused unless its body names it with a reason', () => {
    const { commit } = sandbox();
    const env = { SKIP_JOURNAL: '1', ALLOW_BIG: '1' };
    const bare = commit({ 'a.txt': 'a\n' }, ok('feat: add a'), { env, named: false });
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr, /commit blocked: ALLOW_BIG, SKIP_JOURNAL are set, so name each in the body/u);
    const terse = commit({ 'a.txt': 'a\n' }, ok('feat: add a', 'SKIP_JOURNAL=1, ALLOW_BIG=1.'), { env, named: false });
    assert.notEqual(terse.status, 0, 'a name with no reason is refused');
    const named = commit({ 'a.txt': 'a\n' }, ok('feat: add a', 'SKIP_JOURNAL=1 and ALLOW_BIG=1: the fixture is a generated\nasset the journal rule cannot see.'), { env, named: false });
    assert.equal(named.status, 0, named.stderr);
  });
  test('a plain commit with no variable set needs no hatch line, and SKIP_PEERS or a 0 is no hatch', () => {
    const { commit } = sandbox();
    assert.equal(commit({ 'a.txt': 'a\n' }, ok('feat: add a')).status, 0);
    const quiet = commit({ 'b.txt': 'b\n' }, ok('feat: add b'), { env: { SKIP_PEERS: '1', SKIP_CHECK: '0', ALLOW_BIG: '' } });
    assert.equal(quiet.status, 0, quiet.stderr);
  });
});

describe('escape hatches at push (check-push.mjs)', () => {
  const outgoing = (git) => `refs/heads/main ${git(['rev-parse', 'HEAD']).stdout.trim()} refs/heads/main ${'0'.repeat(40)}\n`;
  test('a push with SKIP_CHECK set is refused unless an outgoing commit names it; none set passes', () => {
    const { commit, git, root } = sandbox();
    assert.equal(commit({ 'a.txt': 'a\n' }, ok('feat: add a')).status, 0);
    const push = (env) => spawnSync('node', [join(root, '.githooks/check-push.mjs')], { cwd: root, encoding: 'utf8', input: outgoing(git), env: { ...ENV, SKIP_PEERS: '1', ...env } });
    const plain = push({});
    assert.equal(plain.status, 0, plain.stderr);
    const refused = push({ SKIP_CHECK: '1' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /push blocked: no outgoing commit names its escape hatch\. SKIP_CHECK is set/u);
    const body = 'Pushed with SKIP_CHECK=1: the cleanup test reads two drifted\nlocal checkouts, not this change.';
    assert.equal(commit({ 'b.txt': 'b\n' }, ok('feat: add b', body)).status, 0);
    const named = push({ SKIP_CHECK: '1' });
    assert.equal(named.status, 0, named.stderr);
  });
});
