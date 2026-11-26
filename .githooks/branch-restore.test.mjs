// Meta QA 11-25 row 113 (J381): re-pushing a deleted branch at its old sha needed --no-verify, because the push gate
// cannot pass on a branch older than a later gate and SKIP_CHECK must be named in a commit nobody can edit. These
// cases drive real pushes through the installed hooks, with a push gate that always fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

const MSG = ok('feat: add files');
// commit-msg's J381 rule: a body paragraph naming the hatch with a reason, wrapped at 72.
const NAMED = ok('feat: add files', 'ALLOW_BRANCH_RESTORE=1: this test sets it on purpose to\nprove the hatch never covers main.');
const FAIL = JSON.stringify({ scripts: { check: 'echo gate ran; exit 1' } });

/** A repo whose origin holds a main with a committed, always-failing `check`, and a deleted-branches log of its own. */
function setup() {
  const box = sandbox();
  const remote = mkdtempSync(join(tmpdir(), 'repo-remote-'));
  const logs = mkdtempSync(join(tmpdir(), 'repo-logs-'));
  roots.push(remote, logs);
  spawnSync('git', ['init', '-q', '--bare', remote], { env: ENV });
  box.git(['remote', 'add', 'origin', remote]);
  const log = join(logs, 'deleted-branches.log');
  const env = { WS_BRANCH_LOG: log, CI: '', GITHUB_ACTIONS: '' };
  const push = (args, extra = {}) => box.git(['push', '-q', 'origin', ...args], { ...env, ...extra });
  assert.equal(box.commit({ 'a.txt': 'a\n', 'package.json': FAIL }, MSG, { env: { SKIP_CHECK: '1' } }).status, 0);
  mkdirSync(join(box.root, 'node_modules'), { recursive: true }); // the gate's own precondition, so it reaches `check`
  assert.equal(push(['main'], { SKIP_CHECK: '1' }).status, 0, 'seed main');
  const head = () => box.git(['rev-parse', 'HEAD']).stdout.trim();
  /** New work on a fresh local branch off main, made with plumbing: the kit's pre-commit refuses a commit on a branch
   * in a canonical checkout (J348), and the branch is the point here, not its files. */
  const branch = (name) => {
    const made = box.git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', MSG]);
    assert.equal(made.status, 0, made.stderr);
    const sha = made.stdout.trim();
    assert.equal(box.git(['branch', name, sha]).status, 0);
    return sha;
  };
  const logLine = (branchName, sha) => appendFileSync(log, `2026-11-25T20:15:17Z ${basename(remote)} remote ${branchName} ${sha.slice(0, 12)}\n`);
  return { box, push, branch, head, logLine };
}

test('re-creating a deleted branch at its logged sha skips the gate; an unlogged branch is gated', () => {
  const { push, branch, logLine } = setup();
  const sha = branch('plan/old');
  assert.equal(push(['--no-verify', 'plan/old']).status, 0, 'first push of the branch');
  const gone = push(['--delete', 'plan/old']);
  assert.equal(gone.status, 0, gone.stderr);
  logLine('plan/old', sha);
  const back = push([`${sha}:refs/heads/plan/old`]);
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stderr, /branch restore of plan\/old at [0-9a-f]{12} \(deleted-branches\.log\): no new commit; push lane skipped/u);
  assert.doesNotMatch(back.stderr, /gate ran/u);

  branch('plan/new');
  const fresh = push(['plan/new']);
  assert.notEqual(fresh.status, 0, 'new work on a new branch keeps the gate');
  assert.match(fresh.stderr, /gate ran/u);
});

test('a logged sha restores only its own branch name', () => {
  const { push, branch, logLine } = setup();
  const sha = branch('plan/a');
  logLine('plan/a', sha);
  const other = push([`${sha}:refs/heads/plan/b`]);
  assert.notEqual(other.status, 0, 'the log names plan/a, not plan/b');
  assert.match(other.stderr, /gate ran/u);
});

test('re-creating a branch at a sha on the destination\'s main skips the gate', () => {
  const { push, head } = setup();
  const back = push([`${head()}:refs/heads/plan/held`]);
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stderr, /branch restore of plan\/held at [0-9a-f]{12} \(on the destination's main\)/u);
});

test('a main push keeps the gate even at a logged sha and with ALLOW_BRANCH_RESTORE=1', () => {
  const { box, push, head, logLine } = setup();
  assert.equal(box.commit({ 'b.txt': 'b\n' }, NAMED, { env: { ALLOW_BRANCH_RESTORE: '1' }, named: false }).status, 0);
  logLine('main', head());
  const logged = push(['main']);
  assert.notEqual(logged.status, 0, 'a logged main sha is still gated');
  assert.match(logged.stderr, /gate ran/u);
  const hatched = push(['main'], { ALLOW_BRANCH_RESTORE: '1' });
  assert.notEqual(hatched.status, 0, 'the hatch never covers main');
  assert.match(hatched.stderr, /gate ran/u);
  // A branch create pushed alongside main is no restore either.
  const mixed = push(['main', `${head()}:refs/heads/plan/side`], { ALLOW_BRANCH_RESTORE: '1' });
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /gate ran/u);
});

test('ALLOW_BRANCH_RESTORE=1 re-creates an unlogged branch without a commit naming it', () => {
  const { box, push, branch } = setup();
  const sha = branch('plan/lost');
  const message = box.git(['log', '-1', '--format=%B', sha]).stdout;
  assert.doesNotMatch(message, /ALLOW_BRANCH_RESTORE/u, 'the published commit does not name the hatch');
  const back = push(['plan/lost'], { ALLOW_BRANCH_RESTORE: '1' });
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stderr, /ALLOW_BRANCH_RESTORE=1 \(J381\): branch create of plan\/lost; push lane skipped/u);
  // An update of an existing branch is no restore: the hatch does not cover it, and the gate still runs.
  const more = box.git(['commit-tree', 'HEAD^{tree}', '-p', sha, '-m', NAMED]);
  assert.equal(box.git(['branch', '-f', 'plan/lost', more.stdout.trim()]).status, 0);
  const update = push(['plan/lost'], { ALLOW_BRANCH_RESTORE: '1' });
  assert.notEqual(update.status, 0, 'an update of an existing branch keeps the gate');
  assert.match(update.stderr, /gate ran/u);
});
