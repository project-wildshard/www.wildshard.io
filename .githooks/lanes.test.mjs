import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

describe('check lanes', () => {
  const MSG = ok('feat: add code');
  const toolchain = (box, scripts) => {
    // Committed: the push lane gates the pushed commit in a clean copy (M1).
    mkdirSync(join(box.root, 'node_modules'), { recursive: true });
    box.commit({ 'package.json': JSON.stringify({ name: 'sandbox', private: true, scripts }) }, MSG, { env: { SKIP_CHECK: '1' } });
  };
  // `true` ignores the file arguments the commit lane appends.
  const pass = { typecheck: 'true', lint: 'true', 'format:check': 'true', check: 'true' };
  // A script that records the file arguments pnpm passed it.
  const record = (file) => `node -e "require('fs').writeFileSync('${file}', process.argv.slice(1).join(' '))" --`;

  test('binary tools install frozen before the push checks and stale locks block them', () => {
    const box = sandbox();
    toolchain(box, pass);
    box.write('package.json', JSON.stringify({ private: true, scripts: pass, binDependencies: { typescript: '7.0.2' } }));
    const bin = join(box.root, 'fake-bin');
    mkdirSync(bin);
    const runner = join(bin, 'pnpm');
    writeFileSync(runner, '#!/bin/sh\necho "$*" >> calls\nif [ "$1" = exec ]; then exit "${FROZEN_STATUS:-0}"; fi\n');
    chmodSync(runner, 0o755);
    const env = { ...ENV, PATH: `${bin}:${process.env.PATH}` };
    const run = () => spawnSync(process.execPath, ['.githooks/run-checks.mjs', 'push'], { cwd: box.root, env, encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.deepEqual(readFileSync(join(box.root, 'calls'), 'utf8').trim().split('\n'), ['exec npr install --frozen', 'run --silent check']);
    rmSync(join(box.root, 'calls'));
    env.FROZEN_STATUS = '7';
    const refused = run();
    assert.equal(refused.status, 7, refused.stderr);
    assert.match(refused.stderr, /frozen binary tool install failed/);
    assert.equal(readFileSync(join(box.root, 'calls'), 'utf8').trim(), 'exec npr install --frozen');
  });
  test('a repo with scripts/release-reuse.mjs skips the push lane for a release-only push (FAST-RELEASE FR2)', () => {
    const box = sandbox();
    toolchain(box, { ...pass, check: 'false' });
    box.write('scripts/release-reuse.mjs', "export const releaseOnlyPush = (_root, refs) => ({ ok: refs.includes('refs/tags/v1.2.3'), reason: 'release-only push (test)' });\n");
    const push = (refs) => spawnSync(process.execPath, ['.githooks/run-checks.mjs', 'push'], { cwd: box.root, env: { ...ENV, WS_PUSH_REFS: refs }, encoding: 'utf8' });
    const skipped = push(`refs/tags/v1.2.3 ${'a'.repeat(40)} refs/tags/v1.2.3 ${'0'.repeat(40)}`);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stderr, /release-only push \(test\): push lane skipped/);
    const gated = push('');
    assert.notEqual(gated.status, 0);
    assert.match(gated.stderr, /pnpm check failed/);
  });
  test('no package.json scripts: lanes stay dormant', () => {
    const result = sandbox().commit({ 'src/a.ts': 'export {};\n' }, MSG);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /lane/);
  });
  test('runs lint, format:check and typecheck on commit', () => {
    const box = sandbox();
    toolchain(box, pass);
    const result = box.commit({ 'src/a.ts': 'export {};\n' }, MSG);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /commit lane: pnpm lint, format:check, typecheck[\s\S]*green/);
  });
  test('lint and format see only the staged code files under src/ and kit/', () => {
    const box = sandbox();
    toolchain(box, { ...pass, lint: record(join(box.root, 'lint.args')), 'format:check': record(join(box.root, 'format.args')) });
    box.write('unstaged.ts', 'export {};\n');
    const result = box.commit({ 'src/a.ts': 'export {};\n', 'src/b.json': '{}\n', 'c.md': '# c\n', 'docs/d.json': '{}\n' }, MSG);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(box.root, 'lint.args'), 'utf8'), 'src/a.ts');
    assert.equal(readFileSync(join(box.root, 'format.args'), 'utf8'), '--no-error-on-unmatched-pattern src/a.ts src/b.json');
  });
  test('a failing script blocks the commit and shows its output', () => {
    const box = sandbox();
    toolchain(box, { ...pass, lint: 'node -e "console.error(\'no-any: a.ts:1\');process.exit(1)"' });
    const result = box.commit({ 'src/a.ts': 'export {};\n' }, MSG);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pnpm lint failed:[\s\S]*no-any: a\.ts:1[\s\S]*pnpm lint:fix/);
  });
  test('a repo with the fix verb is told to run it (D33)', () => {
    const box = sandbox();
    toolchain(box, { ...pass, fix: 'true', lint: 'node -e "process.exit(1)"' });
    const result = box.commit({ 'src/a.ts': 'export {};\n' }, MSG);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /commit blocked\. Fix it \(pnpm fix fixes most of it\)/);
  });
  test('commits with no code or JSON skip the lane', () => {
    const box = sandbox();
    toolchain(box, { ...pass, lint: 'node -e "process.exit(1)"', typecheck: 'node -e "process.exit(1)"' });
    const result = box.commit({ 'docs/x.md': '# x\n', 'run.sh': 'echo hi\n' }, MSG);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no code staged/);
  });
  test('over the hard budget blocks, unless SKIP_BUDGET=1', () => {
    const box = sandbox();
    toolchain(box, { ...pass, typecheck: 'node -e "setTimeout(()=>{},300)"' });
    const slow = { PRECOMMIT_SOFT_S: '0', PRECOMMIT_HARD_S: '0.1' };
    const blocked = box.commit({ 'src/a.ts': 'export {};\n' }, MSG, { env: slow });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /over the 0\.1 s budget/);
    assert.equal(box.commit({ 'src/a.ts': 'export {};\n' }, MSG, { env: { ...slow, SKIP_BUDGET: '1' } }).status, 0);
  });
  test('missing node_modules blocks with a fix', () => {
    const box = sandbox();
    toolchain(box, pass);
    rmSync(join(box.root, 'node_modules'), { recursive: true });
    const result = box.commit({ 'src/a.ts': 'export {};\n' }, MSG);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /node_modules is missing/);
  });
  test('a red pnpm check blocks the push', () => {
    const box = sandbox();
    toolchain(box, { ...pass, check: 'node -e "console.error(\'knip: unused export\');process.exit(1)"' });
    const remote = mkdtempSync(join(tmpdir(), 'repo-remote-'));
    roots.push(remote);
    spawnSync('git', ['init', '-q', '--bare', remote], { env: ENV });
    box.git(['remote', 'add', 'origin', remote]);
    const result = box.git(['push', '-q', 'origin', 'main']);
    assert.notEqual(result.status, 0, 'push should have been blocked');
    assert.match(result.stderr, /push lane: pnpm check[\s\S]*knip: unused export/);
  });
});
