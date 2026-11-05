// The session brief's main-only alarm (D27): it names every extra
// worktree, local branch and remote branch, and is quiet when the
// repo is main only. Runs .claude/hooks/session-brief.sh in a sandbox.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

const BRIEF = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'session-brief.sh');

const setup = () => {
  const box = sandbox();
  cpSync(BRIEF, join(box.root, '.claude', 'hooks', 'session-brief.sh'));
  assert.equal(box.commit({ 'a.txt': 'a\n' }, ok('feat: add a')).status, 0);
  const brief = () => {
    const result = spawnSync('bash', [join(box.root, '.claude', 'hooks', 'session-brief.sh')], { encoding: 'utf8', env: ENV });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split('-- main only')[1].split('\n-- ')[0];
  };
  return { ...box, brief };
};

describe('session brief: main only', () => {
  test('quiet when the repo is main only', () => {
    const { git, brief } = setup();
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    assert.match(brief(), /\(clean: main only\)/);
    assert.doesNotMatch(brief(), /!!/);
  });
  test('names stray worktrees, local branches and remote branches', () => {
    const { root, git, brief } = setup();
    git(['branch', 'feature']);
    git(['update-ref', 'refs/remotes/origin/old-work', 'HEAD']);
    const wt = `${root}-wt`;
    roots.push(wt);
    git(['worktree', 'add', '-q', '--detach', wt]);
    const out = brief();
    assert.match(out, /!! worktree .*-wt/);
    assert.match(out, /!! branch feature/);
    assert.match(out, /!! remote origin\/old-work/);
    assert.match(out, /ask Jake to delete the branch/);
  });
});
