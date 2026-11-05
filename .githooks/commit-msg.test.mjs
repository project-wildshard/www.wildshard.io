import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './check-commit-message.mjs';
import { TRAILER, ok, sandbox } from './test-helpers.mjs';

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
    assert.match(validate('fix: x\n\nBody.\n\nAssisted-by: Claude Code:unknown\n'), /real model/);
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
    const result = commit({ 'a.txt': 'a\n' }, 'feat: add a\n\nBy hand.', { env: { SKIP_ATTRIB: '1' } });
    assert.equal(result.status, 0, result.stderr);
  });
});
