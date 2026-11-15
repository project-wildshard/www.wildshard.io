import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LONG, fixture } from './land-fixture.mjs';

test('J358: copy failure keeps its worktree and local branch', LONG, () => {
  const f = fixture(), wt = f.worktree('copy-failure');
  const tip = f.commit(wt, 'src/a.ts', 'export const a = 2;', 'feature');
  // A regular file cannot contain a keep-copy directory, even as root.
  f.env.WS_SESSION_KEEP_ROOT = join(f.repo, 'src/a.ts');
  const result = f.land(wt, []);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /worktree kept: copy failed/u);
  assert.ok(existsSync(wt));
  assert.equal(f.git(f.repo, ['rev-parse', 'plan/copy-failure']), tip);
});

test('J358: generated-only changes are copied before removal', LONG, () => {
  const f = fixture(), wt = f.worktree('generated');
  f.commit(wt, 'src/bytes.generated.ts', 'export const bytes = 1;', 'generated');
  f.state({ once: { marker: join(f.root, 'once'), command: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(join(wt, 'src/bytes.generated.ts'))}, 'export const bytes = 2;')`] } });
  const result = f.land(wt, []);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(wt), false);
  const day = join(f.root, 'session-keep', readdirSync(join(f.root, 'session-keep'))[0]);
  const copy = join(day, readdirSync(day)[0]);
  assert.match(readFileSync(join(copy, 'tracked.patch'), 'utf8'), /\+export const bytes = 2;/u);
});

test('J358: writes at shutdown retain the source after copying', LONG, async () => {
  const f = fixture(), wt = f.worktree('shutdown');
  f.commit(wt, 'src/bytes.generated.ts', 'export const bytes = 1;', 'generated');
  const marker = join(f.root, 'ready');
  const child = spawn(process.execPath, ['-e', `const fs=require('fs');process.on('SIGTERM',()=>{fs.writeFileSync('src/bytes.generated.ts','export const bytes = 3;');process.exit(0)});fs.writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`], { cwd: wt, stdio: 'ignore' });
  try {
    for (let tries = 0; tries < 100 && !existsSync(marker); tries++) await new Promise(done => setTimeout(done, 20));
    assert.ok(existsSync(marker));
    const result = f.land(wt, []);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /worktree kept: changed during process cleanup/u);
    assert.match(readFileSync(join(wt, 'src/bytes.generated.ts'), 'utf8'), /bytes = 3/u);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
