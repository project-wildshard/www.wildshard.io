// The session brief's main-only alarm (D27): it names every extra
// worktree, local branch and remote branch, and is quiet when the
// repo is main only. Runs the session brief hook in a sandbox.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

// The agent layout (repo-kit agent-sync) keeps hook scripts in .agents/hooks/;
// a repo not yet stamped keeps them in .claude/hooks/.
const hookScript = (root, name) => ['.agents', '.claude'].map((dir) => join(root, dir, 'hooks', name)).find((path) => existsSync(path)) ?? join(root, '.claude', 'hooks', name);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEF = hookScript(ROOT, 'session-brief.sh');
const AT = relative(ROOT, BRIEF);

const setup = () => {
  const box = sandbox();
  cpSync(BRIEF, join(box.root, AT));
  assert.equal(box.commit({ 'a.txt': 'a\n' }, ok('feat: add a')).status, 0);
  const brief = () => {
    const result = spawnSync('bash', [join(box.root, AT)], { encoding: 'utf8', env: ENV });
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
  test('plan worktrees and plan branches are not strays (J240)', () => {
    const { root, git, brief } = setup();
    // The kit brief allows plan worktrees only where the worktree tool is.
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'worktree.mjs'), '');
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(['update-ref', 'refs/remotes/origin/plan/foo', 'HEAD']);
    git(['worktree', 'add', '-q', '-b', 'plan/foo', join(root, '.worktrees', 'foo')]);
    const out = brief();
    assert.match(out, /plan worktrees \(1\): \.worktrees\/foo/);
    assert.match(out, /\(clean: main only\)/);
    assert.doesNotMatch(out, /!!/);
  });
});
