// The git hooks name other live herdr agents (advisory, never blocking),
// using herdr-peers.sh with a fake `herdr` on PATH.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';

// The agent layout (repo-kit agent-sync) keeps hook scripts in .agents/hooks/;
// a repo not yet stamped keeps them in .claude/hooks/.
const hookScript = (root, name) => ['.agents', '.claude'].map((dir) => join(root, dir, 'hooks', name)).find((path) => existsSync(path)) ?? join(root, '.claude', 'hooks', name);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PEERS = hookScript(ROOT, 'herdr-peers.sh');
const AT = relative(ROOT, PEERS);
const bin = mkdtempSync(join(tmpdir(), 'repo-herdr-bin-'));
after(() => rmSync(bin, { recursive: true, force: true }));

const withHerdr = () => {
  const box = sandbox();
  mkdirSync(dirname(join(box.root, AT)), { recursive: true });
  cpSync(PEERS, join(box.root, AT));
  const root = realpathSync(box.root); // git reports the resolved path (/private/var/… on macOS)
  const agents = [
    { pane_id: 'w1:p1', agent_status: 'working', cwd: root, agent_session: { value: 'me' }, terminal_title_stripped: 'Me' },
    { pane_id: 'w1:p2', agent_status: 'working', cwd: root, agent_session: { value: 'peer' }, terminal_title_stripped: 'Build the diff view' },
  ];
  const json = join(bin, `${box.root.split('/').pop()}.json`);
  writeFileSync(json, JSON.stringify({ result: { agents } }));
  writeFileSync(join(bin, 'herdr'), '#!/usr/bin/env bash\ncat "$HERDR_FAKE_JSON"\n');
  chmodSync(join(bin, 'herdr'), 0o755);
  box.env = { HERDR_ENV: '1', CLAUDE_CODE_SESSION_ID: 'me', HERDR_FAKE_JSON: json, PATH: `${bin}:${process.env.PATH}` };
  return box;
};

describe('herdr peers in the git hooks', () => {
  test('pre-commit names the other agents, not this one', () => {
    const box = withHerdr();
    const result = box.commit({ 'a.txt': 'a\n' }, ok('feat: add a'), { env: box.env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /herdr: 1 other agent\(s\) live in this repo[\s\S]*w1:p2 \(working\) — Build the diff view \[main\]/);
    assert.doesNotMatch(result.stderr, /— Me \[/);
  });
  test('pre-push names them too, and SKIP_HERDR_PEERS=1 hides it', () => {
    const box = withHerdr();
    box.commit({ 'a.txt': 'a\n' }, ok('feat: add a'), { env: box.env });
    const remote = mkdtempSync(join(tmpdir(), 'repo-remote-'));
    roots.push(remote);
    spawnSync('git', ['init', '-q', '--bare', remote], { env: ENV });
    box.git(['remote', 'add', 'origin', remote]);
    const result = box.git(['push', '-q', 'origin', 'main'], box.env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /share this repo: a red check below may be their WIP/);
    const hidden = box.commit({ 'b.txt': 'b\n' }, ok('feat: add b'), { env: { ...box.env, SKIP_HERDR_PEERS: '1' } });
    assert.doesNotMatch(hidden.stderr, /herdr:/);
  });
  test('outside herdr the hooks print nothing about peers', () => {
    const result = withHerdr().commit({ 'a.txt': 'a\n' }, ok('feat: add a'));
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /herdr:/);
  });
});
