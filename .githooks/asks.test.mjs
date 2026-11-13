// Tests for the ask tooling: kit/scripts/asks.mjs and kit/scripts/ask-new.sh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkAsk, parseAsk } from '../kit/scripts/asks.mjs';
import { ok, sandbox } from './test-helpers.mjs';

const ask = (id, status, words = '"do the thing"') => `# ${id}\n\n**Status:** ${status}\n**Ask:** ${words}\n`;
const none = () => false;

describe('ask rules', () => {
  test('accepts every status in the vocabulary', () => {
    for (const status of ['open (2026-11-04)', 'in flight (2026-11-04, www.wildshard.io-99)', 'needs pick (2026-11-04)',
      'done (2026-11-04): abc1234', 'dropped (2026-11-04): Jake: "nah"']) {
      assert.deepEqual(checkAsk('A1', ask('A1', status), none), [], status);
    }
  });
  test('folded into / superseded by must name something that exists', () => {
    assert.deepEqual(checkAsk('A1', ask('A1', 'folded into A2'), (t) => t === 'A2'), []);
    assert.match(checkAsk('A1', ask('A1', 'superseded by A9'), none)[0], /must name an existing ask/);
  });
  test('refuses a title that does not match the file', () => {
    assert.match(checkAsk('A2', ask('A1', 'open (2026-11-04)'), none)[0], /first line must be "# A2"/);
  });
  test('refuses a status outside the vocabulary', () => {
    assert.match(checkAsk('A1', ask('A1', 'parked (2026-11-04)'), none)[0], /not one of/);
  });
  test('refuses in flight without its claim, and open / done without a date', () => {
    assert.match(checkAsk('A1', ask('A1', 'in flight'), none)[0], /needs its claim/);
    assert.match(checkAsk('A1', ask('A1', 'open'), none)[0], /needs its date/);
    assert.match(checkAsk('A1', ask('A1', 'done: abc1234'), none)[0], /needs its date/);
  });
  test('refuses a missing Ask line', () => {
    assert.ok(checkAsk('A1', '# A1\n\n**Status:** open (2026-11-04)\n', none).some((m) => /no \*\*Ask:\*\*/.test(m)));
  });
  test('parses closed states', () => {
    assert.equal(parseAsk(ask('A1', 'done (2026-11-04): x')).closed, true);
    assert.equal(parseAsk(ask('A1', 'needs pick (2026-11-04)')).closed, false);
  });
});

describe('ask-new.sh and the pre-commit check', () => {
  test('claims A1, A2, … and writes a valid file', () => {
    const { root } = sandbox();
    const claim = (words) => spawnSync('bash', ['kit/scripts/ask-new.sh', words], { cwd: root, encoding: 'utf8' });
    assert.equal(claim('"first"').stdout.trim(), 'docs/tasks/asks/A1.md');
    assert.equal(claim('"second"').stdout.trim(), 'docs/tasks/asks/A2.md');
    const text = readFileSync(join(root, 'docs/tasks/asks/A2.md'), 'utf8');
    assert.match(text, /^# A2\n\n\*\*Status:\*\* open \(\d{4}-\d{2}-\d{2}\)\n\*\*Ask:\*\* "second"\n$/);
    assert.deepEqual(checkAsk('A2', text, none), []);
  });
  test('pre-commit blocks a malformed ask and passes a good one', () => {
    const box = sandbox();
    const bad = box.commit({ 'docs/tasks/asks/A1.md': ask('A1', 'parked') }, ok('docs(asks): file A1'));
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /docs\/tasks\/asks\/A1\.md: Status "parked" is not one of/);
    const good = box.commit({ 'docs/tasks/asks/A1.md': ask('A1', 'open (2026-11-04)') }, ok('docs(asks): file A1'));
    assert.equal(good.status, 0, good.stderr);
  });
});
