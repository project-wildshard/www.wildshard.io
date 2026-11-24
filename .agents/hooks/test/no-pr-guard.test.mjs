// .agents/hooks/no-pr-guard.mjs (meta QA-FEEDBACK-2026-11-24 row 41): no pull request is opened on a project-wildshard
// repo, from either agent tool; other repos, reads and text pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { opensPr } from '../no-pr-guard.mjs';

const HOOK = fileURLToPath(new URL('../no-pr-guard.mjs', import.meta.url));
const run = (payload) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });

const REMOTES = {
  '/w/kit': 'https://github.com/project-wildshard/repo-kit.git',
  '/w/engine': 'git@github.com:project-wildshard/engine.git',
  '/w/meta': 'git@github.com:Raynos/project-wildshard-meta.git',
  '/w/other': 'git@github.com:someone/else.git',
};
const where = (cwd) => ({ cwd, remoteOf: (dir) => REMOTES[dir] ?? '' });

test('gh pr create on a project-wildshard repo is refused, by flag, GH_REPO or the folder it runs in', () => {
  for (const [command, cwd] of [
    ['gh pr create --fill', '/w/kit'],
    ['gh pr new --title x --body y', '/w/engine'],
    ['gh pr create -R project-wildshard/engine --fill', '/w/other'],
    ['gh pr create --repo=project-wildshard/api-server --fill', '/w/other'],
    ['GH_REPO=project-wildshard/engine gh pr create --fill', '/w/other'],
    ['gh -R project-wildshard/engine pr create --fill', '/w/other'],
    ['cd /w/kit && git push -u origin x && gh pr create --title "fix: a; b" --body "x"', '/w/other'],
    ['git status; gh pr create --fill', '/w/kit'],
    ['echo $(gh pr create --fill)', '/w/kit'],
  ]) {
    assert.match(opensPr(command, where(cwd)) ?? '', /^`gh pr create` on project-wildshard\//u, command);
  }
});

test('a gh api POST to /pulls or a createPullRequest mutation on project-wildshard is refused', () => {
  for (const [command, cwd] of [
    ['gh api repos/project-wildshard/repo-kit/pulls -f title=x -f head=b -f base=main', '/w/other'],
    ['gh api -X POST /repos/project-wildshard/engine/pulls --input body.json', '/w/other'],
    ['gh api --method POST repos/{owner}/{repo}/pulls -f title=x', '/w/kit'],
    ["gh api 'repos/project-wildshard/engine/pulls' -F title=x", '/w/other'],
    ['gh api graphql -f query="mutation { createPullRequest(input: {}) { pullRequest { url } } }"', '/w/engine'],
  ]) {
    assert.notEqual(opensPr(command, where(cwd)), null, command);
  }
});

test('other repos, reads, text and the escape hatch pass', () => {
  for (const [command, cwd] of [
    ['gh pr create --fill', '/w/meta'],
    ['gh pr create --fill', '/w/other'],
    ['gh pr create -R someone/else --fill', '/w/kit'],
    ['gh pr list', '/w/kit'],
    ['gh pr view 6', '/w/kit'],
    ['gh pr close 6 --delete-branch', '/w/kit'],
    ['gh api repos/project-wildshard/repo-kit/pulls', '/w/other'],
    ['gh api repos/project-wildshard/repo-kit/pulls?state=open --jq ".[].number"', '/w/other'],
    ['gh api -X GET repos/project-wildshard/engine/pulls -f state=open', '/w/other'],
    ['gh api -X POST repos/project-wildshard/engine/pulls/6/comments -f body=x', '/w/other'],
    ['gh api -X PATCH repos/project-wildshard/engine/pulls/6 -f state=closed', '/w/other'],
    ['echo "gh pr create" && git commit -m "never gh pr create" -- a', '/w/kit'],
    ['ALLOW_WILDSHARD_PR=1 gh pr create --fill', '/w/kit'],
    ['gh pr create --fill', '/nowhere'],
  ]) {
    assert.equal(opensPr(command, where(cwd)), null, command);
  }
});

test('the hook exits 2 with the way through and the escape hatch; other commands and tools pass silently', () => {
  const blocked = run({ tool_name: 'Bash', tool_input: { command: 'gh pr create -R project-wildshard/engine --fill' } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /BLOCKED by \.agents\/hooks\/no-pr-guard\.mjs: `gh pr create` on project-wildshard\/engine/u);
  assert.match(blocked.stderr, /main-push\.mjs/u);
  assert.match(blocked.stderr, /ALLOW_WILDSHARD_PR=1/u);
  for (const payload of [{ tool_name: 'Bash', tool_input: { command: 'gh pr list -R project-wildshard/engine' } }, { tool_name: 'Edit', tool_input: { file_path: 'x' } }, {}]) {
    const passed = run(payload);
    assert.equal(passed.status, 0);
    assert.equal(passed.stderr, '');
  }
  assert.equal(spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' }).status, 0);
});
