import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gateTestCommand } from './gate-test-command.mjs';
import { gateTestEnvironment, gateWorkers } from './gate-workers.mjs';

const env = { WS_GATE_WORKERS: '4', WS_GATE_VITEST_WORKERS: '4' };

test('the gate uses a quarter of its available cores and validates overrides', () => {
  assert.equal(gateWorkers({}, 18), 4);
  assert.equal(gateWorkers({}, 3), 1);
  assert.equal(gateWorkers({ WS_GATE_WORKERS: '7' }, 18), 7);
  assert.throws(() => gateWorkers({ WS_GATE_WORKERS: '0' }, 18), /positive integer/u);
  assert.throws(() => gateWorkers({ WS_GATE_WORKERS: '2.5' }, 18), /positive integer/u);
  assert.equal(gateTestEnvironment({ WS_GATE_WORKERS: '4' }, 2).WS_GATE_VITEST_WORKERS, '2');
});

test('Node test flags are bounded while ordinary script arguments stay intact', () => {
  assert.deepEqual(gateTestCommand(['--import', 'loader.mjs', '--test', 'probe.test.mjs'], env).args,
    ['--test-concurrency=4', '--import', 'loader.mjs', '--test', 'probe.test.mjs']);
  assert.deepEqual(gateTestCommand(['--test', '--test-concurrency', '16', 'probe.test.mjs'], env).args,
    ['--test', '--test-concurrency=4', 'probe.test.mjs']);
  assert.deepEqual(gateTestCommand(['--test', '--test-concurrency=1', 'probe.test.mjs'], env).args,
    ['--test', '--test-concurrency=1', 'probe.test.mjs']);
  assert.deepEqual(gateTestCommand(['script.mjs', '--test'], env).args, ['script.mjs', '--test']);
});

test('Vitest flags and its worker environment obey the same ceiling', () => {
  const entry = '/fixture/node_modules/vitest/vitest.mjs';
  const injected = gateTestCommand([entry, 'run'], env);
  assert.deepEqual(injected.args, [entry, '--maxWorkers=4', 'run']);
  const bounded = gateTestCommand([entry, 'run', '--max-workers', '9'], { ...env, VITEST_MAX_WORKERS: '3' });
  assert.deepEqual(bounded.args, [entry, 'run', '--max-workers=3']);
  assert.equal(bounded.env.VITEST_MAX_WORKERS, undefined);
  assert.deepEqual(gateTestCommand([entry, 'run', '--maxWorkers=1'], env).args, [entry, 'run', '--maxWorkers=1']);
});

test('a nested shell runs real Node tests one file at a time when the gate asks for one', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'gate-workers-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = `
    import { test } from 'node:test';
    import { openSync, closeSync, unlinkSync } from 'node:fs';
    test('holds the shared file', async () => {
      const file = openSync('active', 'wx');
      try { await new Promise(resolve => setTimeout(resolve, 100)); }
      finally { closeSync(file); unlinkSync('active'); }
    });
  `;
  for (const file of ['a.test.mjs', 'b.test.mjs', 'c.test.mjs']) writeFileSync(join(root, file), fixture);
  const variables = gateTestEnvironment({ ...process.env, WS_GATE_WORKERS: '1' });
  delete variables.NODE_TEST_CONTEXT;
  const result = spawnSync('sh', ['-c', 'node --test --test-reporter=tap --test-concurrency=12 ./*.test.mjs'], {
    cwd: root, env: variables, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /# pass 3/u);
});
