// Meta QA 11-25 row 41 (J505): CI's setup-node reads `engines.node` (`node-version-file: package.json`) and takes the
// newest cached Node that satisfies it. Engine's `>=24.18.0` alone resolved to Node 26.13.1 on the hosted runners, which
// refuses `--experimental-transform-types`, and main went red (engine run 45628242073). Every repo keeps an upper bound
// on its Node range until the org moves Node majors together (row 42). Kit-owned: edit repo-kit's copy under files/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('engines.node names an upper bound, so CI never picks an untried Node major', () => {
  const file = join(process.cwd(), 'package.json');
  if (!existsSync(file)) return;
  const range = JSON.parse(readFileSync(file, 'utf8'))?.engines?.node;
  if (range === undefined) return;
  assert.match(String(range), /^>=\d+\.\d+\.\d+ <\d+$/u, `engines.node "${range}" needs an upper bound, such as ">=24.18.0 <25"`);
});
