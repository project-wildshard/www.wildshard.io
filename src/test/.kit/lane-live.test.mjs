import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { laneLive } from '../../scripts/.kit/lane-live.mjs';

mkdirSync('tmp/codex-netlag', { recursive: true });

const root = mkdtempSync(resolve('tmp/codex-netlag/lane-live-'));

function lane(name, laneName, receiptOffset = 0) {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, '.owner'), JSON.stringify({ lane: laneName, receiptOffset, started: '2026-11-13T00:00:00Z' }));
  return path;
}

test('it keeps silent wall-clock-old lanes live, ends only on DONE, and protects a process cwd', () => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  try {
    const receipts = join(root, 'receipts.log');
    writeFileSync(receipts, '10:00 UTC done DONE: work\n10:01 UTC paused PAUSED: work\n');
    assert.deepEqual(laneLive(lane('frozen', 'frozen'), { receipts, activeHours: 0, cwdLive: false }), { state: 'live', reason: 'no ending receipt' });
    assert.deepEqual(laneLive(lane('done', 'done'), { receipts, activeHours: 0, cwdLive: false }), { state: 'ended', reason: 'ending receipt' });
    assert.deepEqual(laneLive(lane('paused', 'paused'), { receipts, activeHours: 30, cwdLive: false, sessionLive: false }), { state: 'ended', reason: 'owner gone and silent for 24 active hours' });
    assert.deepEqual(laneLive(lane('present', 'paused'), { receipts, activeHours: 30, cwdLive: false, sessionLive: true }), { state: 'live', reason: 'owner session is present' });
    assert.equal(laneLive(lane('running-done', 'done'), { receipts, activeHours: 0, cwds: [], sessionLive: true }).state, 'live');
    const reused = lane('reused', 'done', statSync(receipts).size);
    assert.equal(laneLive(reused, { receipts, activeHours: 0, cwds: [], sessionLive: false }).state, 'live');
    appendFileSync(receipts, '10:02 UTC done DONE: newer task\n');
    assert.equal(laneLive(reused, { receipts, activeHours: 0, cwds: [], sessionLive: false }).state, 'ended');
    const legacy = lane('legacy', 'done', null);
    assert.equal(laneLive(legacy, { receipts, activeHours: 0, cwds: [], sessionLive: false }).state, 'live');
    assert.deepEqual(laneLive(lane('busy', 'done'), { receipts, activeHours: 0, cwdLive: true }), { state: 'live', reason: 'a process cwd or pidfile is live' });
    const pidRoot = lane('server', 'done');
    writeFileSync(join(pidRoot, 'server.pid'), String(process.pid));
    assert.equal(laneLive(pidRoot, { receipts, cwds: [] }).state, 'live');
    assert.equal(laneLive(lane('blind', 'done'), { receipts, cwds: null }).state, 'live');
    const nested = lane('nested', 'done');
    mkdirSync(join(nested, 'dev-123'));
    writeFileSync(join(nested, 'dev-123/server.pid'), String(process.pid));
    assert.equal(laneLive(nested, { receipts, cwds: [] }).state, 'live');
    const unowned = join(root, 'unowned');
    mkdirSync(unowned);
    assert.match(laneLive(unowned, { receipts, cwds: [], activeHours: 72 }).reason, /72 active hours/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// lean-layout H1: the owner's hc terminal (scratch-dir's `pane`, now $HC_TERMINAL_ID) is live while `hc get` says
// so. A fake hc on PATH answers; the real one is never run.
test('an owner whose hc terminal is live keeps its lane live; a gone terminal does not', () => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'hc'), '#!/bin/sh\n[ "$1" = get ] || exit 64\ncase "$2" in t-live) echo \'{"state":"live"}\' ;; *) exit 1 ;; esac\n', { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  try {
    const receipts = join(root, 'receipts.log');
    writeFileSync(receipts, '10:00 UTC done DONE: work\n');
    const owned = (name, pane) => {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(join(dir, '.owner'), JSON.stringify({ lane: 'done', session: 'sess-gone', pane, receiptOffset: 0 }));
      return dir;
    };
    assert.deepEqual(laneLive(owned('live', 't-live'), { receipts, cwds: [], activeHours: 0 }), { state: 'live', reason: 'owner session is present' });
    assert.equal(laneLive(owned('gone', 't-gone'), { receipts, cwds: [], activeHours: 0 }).state, 'ended');
  } finally {
    process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  }
});
