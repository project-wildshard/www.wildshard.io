// The git hooks name other live agents (advisory, never blocking), using
// .agents/hooks/peers.sh with a fake `hc` (herdr-core) on PATH.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AT = '.agents/hooks/peers.sh';
const bin = mkdtempSync(join(tmpdir(), 'repo-hc-bin-'));
after(() => rmSync(bin, { recursive: true, force: true }));

// `hc ls` lists terminals; `hc get <t>` gives one, with the folder it works in now.
const FAKE_HC = '#!/usr/bin/env bash\ncase "$1" in\n  ls) jq -c \'{terminals: [.[] | {address, agent, state}]}\' "$HC_FAKE_JSON" ;;\n  get) jq -c --arg t "$2" \'.[] | select(.address == $t)\' "$HC_FAKE_JSON" ;;\nesac\n';

const withHc = () => {
  const box = sandbox();
  mkdirSync(dirname(join(box.root, AT)), { recursive: true });
  cpSync(join(ROOT, AT), join(box.root, AT));
  const root = realpathSync(box.root); // git reports the resolved path (/private/var/… on macOS)
  const terminals = [
    { address: 't1', agent: 'claude-code', state: 'live', status: { state: 'working', msg: 'Me' }, cwd: '/elsewhere', foreground: { cwd: root } },
    { address: 't2', agent: 'claude-code', state: 'live', status: { state: 'working', msg: 'Build the diff view' }, cwd: '/elsewhere', foreground: { cwd: root } },
    { address: 't3', agent: 'bash', state: 'live', cwd: root, foreground: { cwd: root } },
  ];
  const json = join(bin, `${box.root.split('/').pop()}.json`);
  writeFileSync(json, JSON.stringify(terminals));
  writeFileSync(join(bin, 'hc'), FAKE_HC);
  chmodSync(join(bin, 'hc'), 0o755);
  box.env = { HC_TERMINAL_ID: 't1', HC_FAKE_JSON: json, PATH: `${bin}:${process.env.PATH}` };
  return box;
};

describe('hc peers in the git hooks', () => {
  test('pre-commit names the other agents, not this one or a shell', () => {
    const box = withHc();
    const result = box.commit({ 'a.txt': 'a\n' }, ok('feat: add a'), { env: box.env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /hc: 1 other agent\(s\) live in this repo[\s\S]*t2 \(working\) — Build the diff view \[main\]/);
    assert.doesNotMatch(result.stderr, /— Me \[|t3 \(/);
  });
  test('pre-push names them too, and SKIP_PEERS=1 hides it', () => {
    const box = withHc();
    box.commit({ 'a.txt': 'a\n' }, ok('feat: add a'), { env: box.env });
    const remote = mkdtempSync(join(tmpdir(), 'repo-remote-'));
    roots.push(remote);
    spawnSync('git', ['init', '-q', '--bare', remote], { env: ENV });
    box.git(['remote', 'add', 'origin', remote]);
    const result = box.git(['push', '-q', 'origin', 'main'], box.env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /share this repo: a red check below may be their WIP/);
    const hidden = box.commit({ 'b.txt': 'b\n' }, ok('feat: add b'), { env: { ...box.env, SKIP_PEERS: '1' } });
    assert.doesNotMatch(hidden.stderr, /hc:/);
  });
  test('outside hc the hooks print nothing about peers', () => {
    const result = withHc().commit({ 'a.txt': 'a\n' }, ok('feat: add a'));
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /hc:/);
  });
});
