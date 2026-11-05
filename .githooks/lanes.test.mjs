import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

describe('check lanes', () => {
  const MSG = ok('feat: add code');
  const toolchain = (box, scripts) => {
    box.write('package.json', JSON.stringify({ name: 'sandbox', private: true, scripts }));
    mkdirSync(join(box.root, 'node_modules'), { recursive: true });
    box.commit({}, MSG, { env: { SKIP_CHECK: '1' } });
  };
  // `true` ignores the file arguments the commit lane appends.
  const pass = { typecheck: 'true', lint: 'true', 'format:check': 'true', check: 'true' };
  // A script that records the file arguments pnpm passed it.
  const record = (file) => `node -e "require('fs').writeFileSync('${file}', process.argv.slice(1).join(' '))" --`;

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
  test('lint and format see only the staged code files under src/', () => {
    const box = sandbox();
    toolchain(box, { ...pass, lint: record('lint.args'), 'format:check': record('format.args') });
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
