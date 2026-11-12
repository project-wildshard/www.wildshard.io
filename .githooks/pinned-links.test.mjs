// The pinned-links guard: a shared checkout whose node_modules/@wildshard/*
// alias points at a live source checkout (a leftover `local link`) tests
// other lanes' half-done edits, not the pinned install CI uses. Commits
// warn; pushes refuse unless a deliberate, unexpired local-link receipt
// in the checkout's git dir names the link and the pushing lane.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ENV, ok, roots, sandbox } from './test-helpers.mjs';
import { linkReceipt, unpinnedLinks } from './pinned-links.mjs';

const MSG = ok('feat: add files');
const HOUR = 3_600_000;

/** A consumer with @wildshard/engine installed from a fake pnpm store or linked to a live checkout. */
function consumer({ live, modules = 'absolute' }) {
  const box = sandbox();
  box.write('package.json', JSON.stringify({
    name: '@wildshard/demo',
    dependencies: { '@wildshard/engine': 'github:project-wildshard/engine#abc', '@wildshard/demo': 'link:.' },
  }));
  box.write('.gitignore', 'node_modules/\n');
  const outside = mkdtempSync(join(tmpdir(), 'pinned-links-'));
  roots.push(outside);
  const store = join(outside, 'store', 'links', '@wildshard', 'engine', '0.1.2', 'hash', 'node_modules', '@wildshard', 'engine');
  const checkout = join(outside, 'engine');
  for (const dir of [store, checkout]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"@wildshard/engine"}\n');
  }
  mkdirSync(join(box.root, 'node_modules', '@wildshard'), { recursive: true });
  // Real installs write virtualStoreDir relative to node_modules: the global store's links dir, or classic .pnpm.
  const classic = join(box.root, 'node_modules', '.pnpm', '@wildshard+engine@0.1.2', 'node_modules', '@wildshard', 'engine');
  const virtualStoreDir = { absolute: join(outside, 'store', 'links'), relative: relative(join(box.root, 'node_modules'), join(outside, 'store', 'links')), classic: '.pnpm' }[modules];
  if (virtualStoreDir !== undefined) box.write('node_modules/.modules.yaml', JSON.stringify({ virtualStoreDir }));
  if (modules === 'classic') {
    mkdirSync(classic, { recursive: true });
    writeFileSync(join(classic, 'package.json'), '{"name":"@wildshard/engine"}\n');
  }
  symlinkSync(live ? checkout : modules === 'classic' ? classic : store, join(box.root, 'node_modules', '@wildshard', 'engine'));
  symlinkSync('../..', join(box.root, 'node_modules', '@wildshard', 'demo'));
  const remote = mkdtempSync(join(tmpdir(), 'repo-remote-'));
  roots.push(remote);
  spawnSync('git', ['init', '-q', '--bare', remote], { env: ENV });
  box.git(['remote', 'add', 'origin', remote]);
  box.push = (env = {}) => box.git(['push', '-q', 'origin', 'main'], env);
  box.receipt = (body) => {
    const path = box.git(['rev-parse', '--path-format=absolute', '--git-path', 'wildshard-local-link.json']).stdout.trim();
    writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  };
  return { box, checkout, store };
}

describe('pinned-links guard', () => {
  test('a store install and the self link:. alias pass', () => {
    const { box } = consumer({ live: false });
    assert.deepEqual(unpinnedLinks(box.root), []);
  });
  test('a live checkout behind @wildshard/engine is named with its real path', () => {
    const { box, checkout } = consumer({ live: true });
    assert.deepEqual(unpinnedLinks(box.root), [{ name: '@wildshard/engine', resolved: realpathSync(checkout) }]);
  });
  test('without .modules.yaml a path outside any node_modules still counts as live', () => {
    assert.equal(unpinnedLinks(consumer({ live: true, modules: 'none' }).box.root).length, 1);
    assert.equal(unpinnedLinks(consumer({ live: false, modules: 'none' }).box.root).length, 0);
  });
  test('a relative store path and a classic .pnpm install both count as pinned', () => {
    for (const modules of ['relative', 'classic']) {
      assert.deepEqual(unpinnedLinks(consumer({ live: false, modules }).box.root), [], modules);
      assert.equal(unpinnedLinks(consumer({ live: true, modules }).box.root).length, 1, modules);
    }
  });
  test('a worktree with no node_modules is judged by the checkout Node falls back to', () => {
    const { box } = consumer({ live: true });
    const worktree = join(box.root, '.worktrees', 'slug');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, 'package.json'), readFileSync(join(box.root, 'package.json')));
    assert.deepEqual(unpinnedLinks(worktree).map(({ name }) => name), ['@wildshard/engine']);
  });
  test('a commit only warns', () => {
    const { box } = consumer({ live: true });
    const result = box.commit({ 'a.txt': 'a\n' }, MSG);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /node_modules\/@wildshard\/engine resolves to a live checkout/);
  });
  test('a push is refused and says how to restore the pin', () => {
    const { box } = consumer({ live: true });
    assert.equal(box.commit({ 'a.txt': 'a\n' }, MSG).status, 0);
    const result = box.push();
    assert.notEqual(result.status, 0, 'push with a live engine link should be blocked');
    assert.match(result.stderr, /push blocked[\s\S]*@wildshard\/engine[\s\S]*local pinned --consumer[\s\S]*pnpm install --frozen-lockfile/);
  });
  test('a pinned install pushes quietly', () => {
    const { box } = consumer({ live: false });
    assert.equal(box.commit({ 'a.txt': 'a\n' }, MSG).status, 0);
    const result = box.push();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /live checkout/);
  });
  test('a deliberate, unexpired receipt lets only its own lane push, with a warning', () => {
    const { box, checkout } = consumer({ live: true });
    assert.equal(box.commit({ 'a.txt': 'a\n' }, MSG).status, 0);
    box.receipt({ lane: 'opus-link', reason: 'linked engine proof', expires: new Date(Date.now() + HOUR).toISOString(), links: { '@wildshard/engine': checkout } });
    const other = box.push({ WS_LANE_NAME: 'opus-other' });
    assert.notEqual(other.status, 0, 'another lane must not push on the linking lane\'s source');
    assert.match(other.stderr, /held by opus-link: only WS_LANE_NAME=opus-link may push/);
    const own = box.push({ WS_LANE_NAME: 'opus-link' });
    assert.equal(own.status, 0, own.stderr);
    assert.match(own.stderr, /local-link receipt from opus-link/);
  });
  test('a receipt that does not name the live link does not cover it', () => {
    const { box } = consumer({ live: true });
    box.receipt({ lane: 'opus-link', reason: 'format only', expires: new Date(Date.now() + HOUR).toISOString(), links: { '@wildshard/format': '/elsewhere' } });
    assert.equal(box.commit({ 'a.txt': 'a\n' }, MSG).status, 0);
    const result = box.push({ WS_LANE_NAME: 'opus-link' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not name @wildshard\/engine/);
  });
  test('an expired, too-long or malformed receipt does not count', () => {
    const { box } = consumer({ live: true });
    const now = Date.now();
    const links = { '@wildshard/engine': '/x' };
    box.receipt({ lane: 'opus-link', reason: 'old', expires: new Date(now - HOUR).toISOString(), links });
    assert.match(linkReceipt(box.root, now).problem, /expired/);
    box.receipt({ lane: 'opus-link', reason: 'forever', expires: new Date(now + 48 * HOUR).toISOString(), links });
    assert.match(linkReceipt(box.root, now).problem, /24 h/);
    box.receipt('not json');
    assert.match(linkReceipt(box.root, now).problem, /not JSON/);
    box.receipt({ lane: 'opus-link', reason: 'no links', expires: new Date(now + HOUR).toISOString() });
    assert.match(linkReceipt(box.root, now).problem, /no links named/);
    box.receipt({ reason: 'no lane', expires: new Date(now + HOUR).toISOString(), links });
    assert.match(linkReceipt(box.root, now).problem, /lane/);
    assert.equal(box.commit({ 'a.txt': 'a\n' }, MSG).status, 0);
    const result = box.push({ WS_LANE_NAME: 'opus-link' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /receipt ignored/);
  });
});
