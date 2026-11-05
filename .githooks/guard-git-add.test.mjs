// Tests for the Claude Code PreToolUse guard .claude/hooks/guard-git-add.sh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'guard-git-add.sh');
const guard = (command) =>
  spawnSync('bash', [GUARD], { cwd: tmpdir(), input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });
const blocks = (command) => {
  const result = guard(command);
  assert.equal(result.status, 2, `expected a block for: ${command}`);
  assert.match(result.stderr, /BLOCKED by \.claude\/hooks\/guard-git-add\.sh/);
};
const allows = (command) => assert.equal(guard(command).status, 0, `expected to allow: ${command}`);

describe('guard-git-add', () => {
  test('blocks whole-index staging', () => {
    blocks('git add -A');
    blocks('git add --all');
    blocks('git add -Av');
    blocks('git add .');
    blocks('git add -u');
    blocks('git -C /repo add -A');
    blocks('git status && git add . && git commit -m x -- a');
  });
  test('blocks commit -a and a bare commit', () => {
    blocks('git commit -am "fix: x"');
    blocks('git commit -a -m "fix: x"');
    blocks('git commit -m "fix: x"');
    blocks('git commit -q -F msg.txt');
  });
  test('a -- inside the message or a sibling command does not count', () => {
    blocks('git commit -m "fix: x -- y"');
    blocks('git diff -- a.ts && git commit -m "fix: x"');
  });
  test('allows pathspec commits and new-file adds', () => {
    allows('git add src/new.ts');
    allows('git commit -m "fix: x; y | z" -- src/a.ts project/journal/2026-11-04.md');
    allows('git add src/new.ts && git commit -q -m "feat: x" -m "body" -- src/new.ts');
    allows("git commit -q -F - -- a b <<'EOF'\nfix: x\n\nbody with ; and | and --\nEOF");
  });
  test('allows --amend, other commands and the escape hatch', () => {
    allows('git commit --amend --no-edit');
    allows('git status --short && git log --oneline -3');
    allows('SKIP_SWEEPGUARD=1 git commit -m "chore: whole index"');
    allows('echo "git add -A is banned"');
  });
});
