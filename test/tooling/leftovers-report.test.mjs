import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fixtureScratch } from './owned-scratch.mjs';
import { brief, leftovers } from '../../scripts/leftovers-report.mjs';

const root = fixtureScratch('leftovers-report-fixture');

test('it reports ended, live and ownerless folders without deleting them', () => {
  rmSync(root, { recursive: true, force: true });
  try {
    for (const name of ['ended', 'live', 'unknown']) mkdirSync(join(root, 'tmp', name), { recursive: true });
    writeFileSync(join(root, 'tmp/ended/.owner'), JSON.stringify({ lane: 'lane-ended', receiptOffset: 0 }));
    writeFileSync(join(root, 'tmp/live/.owner'), JSON.stringify({ lane: 'lane-live' }));
    const receipts = join(root, 'receipts.log');
    writeFileSync(receipts, '10:00 UTC lane-ended DONE: test\n10:01 UTC lane-live PAUSED: test\n');
    const rows = leftovers({ root, receipts });
    assert.deepEqual(Object.fromEntries(rows.map(row => [row.name, row.state])), { ended: 'ended', live: 'live', unknown: 'unknown' });
    assert.ok(brief(rows).every(line => line.startsWith('  ')));
    assert.equal(rows.length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
