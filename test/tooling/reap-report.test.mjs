import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fixtureScratch } from './owned-scratch.mjs';
import { reap } from '../../scripts/worktree-reap.mjs';

test('reap keeps a landed worktree and branch while reporting its liveness', () => {
  const root = fixtureScratch('reap-report-fixture');
  mkdirSync(root, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.test' },
  }).trim();
  try {
    git('init', '-q');
    git('commit', '--allow-empty', '-qm', 'seed');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const tree = join(root, '.worktrees/ended');
    git('worktree', 'add', '-qb', 'plan/ended', tree);
    writeFileSync(join(tree, '.owner'), JSON.stringify({ lane: 'fixture' }));
    const receipts = join(root, 'receipts.log');
    writeFileSync(receipts, '10:00 UTC fixture DONE: fixture\n');
    const lines = [];
    assert.equal(reap(root, { dryRun: false, graceHours: 0, staleHours: 0, remote: true },
      { WS_LANE_RECEIPTS: receipts }, line => lines.push(line)), 0);
    assert.ok(existsSync(tree));
    assert.equal(git('rev-parse', 'plan/ended'), git('rev-parse', 'HEAD'));
    assert.match(lines.join('\n'), /manual audit, copy before removal/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
