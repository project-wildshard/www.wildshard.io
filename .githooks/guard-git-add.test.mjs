// Tests for the PreToolUse guard guard-git-add.sh (.agents/hooks/, or
// .claude/hooks/ before the agent layout).
import { test, describe } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The agent layout (repo-kit agent-sync) keeps hook scripts in .agents/hooks/;
// a repo not yet stamped keeps them in .claude/hooks/.
const hookScript = (root, name) => ['.agents', '.claude'].map((dir) => join(root, dir, 'hooks', name)).find((path) => existsSync(path)) ?? join(root, '.claude', 'hooks', name);
const GUARD = hookScript(join(dirname(fileURLToPath(import.meta.url)), '..'), 'guard-git-add.sh');
const guard = (command) =>
  spawnSync('bash', [GUARD], { cwd: tmpdir(), input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });
const blocks = (command) => {
  const result = guard(command);
  assert.equal(result.status, 2, `expected a block for: ${command}`);
  assert.match(result.stderr, /BLOCKED by \.(?:agents|claude)\/hooks\/guard-git-add\.sh/);
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

// A merge commit takes no pathspec. It passes when it brings in only
// upstream's changes (MERGE_HEAD set, every staged path one upstream
// changed), found from the session's cwd, a `cd <dir>` or `git -C <dir>`.
test('guard-git-add: a merge commit of upstream changes passes; extra staged paths do not', () => {
  const scratch = join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp');
  mkdirSync(scratch, { recursive: true });
  const repo = mkdtempSync(join(scratch, 'sweep-merge-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  try {
    const git = (...args) => {
      const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stderr);
    };
    const put = (path, text) => writeFileSync(join(repo, path), text);
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    put('a.txt', '1\n');
    put('b.txt', '1\n');
    git('add', 'a.txt', 'b.txt');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'upstream');
    put('a.txt', '2\n');
    git('commit', '-q', '-m', 'upstream', '--', 'a.txt');
    git('checkout', '-q', 'main');
    put('b.txt', '2\n');
    git('commit', '-q', '-m', 'mine', '--', 'b.txt');
    const run = (command, cwd) =>
      spawnSync('bash', [GUARD], { cwd: tmpdir(), input: JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } }), encoding: 'utf8', env });
    assert.equal(run('git commit --no-edit', repo).status, 2, 'no merge in progress: a bare commit');
    git('merge', '-q', '--no-ff', '--no-commit', 'upstream');
    for (const [command, cwd] of [['git commit --no-edit', repo], [`cd ${repo} && git commit --no-edit`, tmpdir()], [`git -C ${repo} commit -q --no-edit`, tmpdir()]]) {
      const result = run(command, cwd);
      assert.equal(result.status, 0, `${command}\n${result.stderr}`);
    }
    assert.equal(run('git commit --no-edit', tmpdir()).status, 2, 'from a folder that is not the merging repo');
    // A path upstream did not change, staged into the merge (another agent's file).
    put('c.txt', 'not upstream\n');
    git('add', 'c.txt');
    const extra = run(`cd ${repo} && git commit --no-edit`, tmpdir());
    assert.equal(extra.status, 2);
    assert.match(extra.stderr, /upstream did not change: c\.txt/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
