// .agents/hooks/pkill-guard.mjs (meta QA 11-25 row 24): no kill by name or pattern from an agent shell, from either
// agent tool; `kill <pid>`, a pgrep listing and quoted text pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { killsByPattern } from '../pkill-guard.mjs';

const HOOK = fileURLToPath(new URL('../pkill-guard.mjs', import.meta.url));
const run = (payload) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });

test('pkill and killall are refused as a command word, behind env, wrappers, pipes and substitutions', () => {
  for (const [command, tool] of [
    ['pkill -f "node --test --test-reporter=dot .githooks"', 'pkill'],
    ['pkill -TERM -f "node --test" 2>/dev/null; sleep 2', 'pkill'],
    ['sleep 3; pkill node', 'pkill'],
    ['cd /w && pkill -9 vite', 'pkill'],
    ['/usr/bin/pkill chromium', 'pkill'],
    ['sudo pkill -f wrangler', 'pkill'],
    ['FOO=1 timeout 5 pkill x', 'pkill'],
    ['killall node', 'killall'],
    ['killall -9 "Google Chrome"', 'killall'],
    ['pgrep -f vite | xargs pkill', 'pkill'],
    ['echo $(pkill x)', 'pkill'],
    ['(pkill x)', 'pkill'],
    ['true\npkill x', 'pkill'],
  ]) {
    assert.equal(killsByPattern(command), tool, command);
  }
});

test('kill by pid, pgrep, text that mentions pkill, and the escape hatch pass', () => {
  for (const command of [
    'kill 1234',
    'kill -TERM 1234 5678',
    'kill $(pgrep -f "my-lane-server")',
    'pgrep -fl pkill',
    'echo "pkill -f x"',
    "git commit -m 'refuse pkill and killall'",
    'grep -n pkill .agents/hooks/pkill-guard.mjs',
    'node scripts/pkill-report.mjs',
    'ALLOW_PKILL=1 pkill -f my-own-unique-tag',
    'mypkill x',
  ]) {
    assert.equal(killsByPattern(command), null, command);
  }
});

test('the hook refuses with exit 2 and the way through, passes the rest, and never breaks on bad input', () => {
  const refused = run({ tool_name: 'Bash', tool_input: { command: 'pkill -f vite' } });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /BLOCKED by \.agents\/hooks\/pkill-guard\.mjs: `pkill`/u);
  assert.match(refused.stderr, /kill <pid>/u);
  assert.match(refused.stderr, /session-cleanup\.mjs --sweep --kill/u);
  assert.match(refused.stderr, /ALLOW_PKILL=1/u);
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'kill 42' } }).status, 0);
  assert.equal(run({ tool_name: 'Read', tool_input: { file_path: '/x' } }).status, 0);
  const bad = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stderr, '');
});
