// Tests for the peers section of .agents/hooks/session-brief.sh, with a
// fake `hc` (herdr-core) on PATH: `hc ls` lists terminals, `hc get <t>`
// gives one, with the folder its agent works in now.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { fixtureScratch } from '../src/test/.kit/owned-scratch.mjs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = dirname(spawnSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding: 'utf8'}).stdout.trim());
const BRIEF = join(ROOT, '.agents', 'hooks', 'session-brief.sh');
const bin = fixtureScratch('repo-hc');
after(() => rmSync(bin, { recursive: true, force: true }));

const terminal = (address, cwd, { msg = '', state = 'working', labels = {}, agent = 'claude-code' } = {}) => ({
  address, agent, state: 'live', status: { app: agent, msg, state }, cwd: '/launched/elsewhere', foreground: { cwd }, labels,
});
const TERMINALS = join(bin, 'terminals.json');
writeFileSync(TERMINALS, JSON.stringify([
  terminal('t1', ROOT, { msg: 'Me, myself' }),
  terminal('t2', CANONICAL, { state: 'idle', msg: 'Build the queue view' }),
  terminal('t3', join(CANONICAL, '.claude/worktrees/agent-x/src'), { msg: 'busy', labels: { goal: 'scaffold' } }),
  terminal('t4', join(CANONICAL, 'docs')),
  terminal('t5', '/Users/someone/other-repo', { msg: 'Other repo' }),
  terminal('t6', CANONICAL, { agent: 'bash', msg: 'a shell' }),
]));
writeFileSync(join(bin, 'hc'), `#!/usr/bin/env bash\ncase "$1" in\n  ls) jq -c '{terminals: [.[] | {address, agent, state}]}' "${TERMINALS}" ;;\n  get) jq -c --arg t "$2" '.[] | select(.address == $t)' "${TERMINALS}" ;;\nesac\n`);
chmodSync(join(bin, 'hc'), 0o755);

const IDENTITY = /^(?:HC_|HERDR_)|^CLAUDE_CODE_SESSION_ID$/;
const brief = (env, input = '') => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !IDENTITY.test(key)));
  const result = spawnSync('bash', [BRIEF], { input, encoding: 'utf8', env: { ...clean, PATH: `${bin}:${process.env.PATH}`, ...env } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('-- live plans')[0];
};

describe('session brief: hc peers', () => {
  test('lists the other agents in this repo, not self, shells or other repos', () => {
    const out = brief({ HC_TERMINAL_ID: 't1' });
    assert.match(out, /t2 {2}idle {2}Build the queue view {2}\[main\]/);
    assert.match(out, /t3 {2}working {2}scaffold {2}\[\.claude\/worktrees\/agent-x\]/);
    assert.match(out, /t4 {2}working {2}\(no goal set\) {2}\[main\]/);
    assert.match(out, /commit only your own paths/);
    assert.doesNotMatch(out, /Me, myself|Other repo|a shell/);
  });
  test('leaves out whichever terminal it runs in', () => {
    const out = brief({ HC_TERMINAL_ID: 't2' });
    assert.match(out, /Me, myself/);
    assert.doesNotMatch(out, /Build the queue view/);
  });
  test('says so when not inside hc', () => {
    assert.match(brief({}), /\(not running inside hc\)/);
  });
  test('says so when it is the only agent', () => {
    const all = readFileSync(TERMINALS, 'utf8');
    writeFileSync(TERMINALS, JSON.stringify([terminal('t1', ROOT)]));
    try { assert.match(brief({ HC_TERMINAL_ID: 't1' }), /you're the only agent here/); }
    finally { writeFileSync(TERMINALS, all); }
  });
});
// K4: the brief lands in every session's context, so it stays within
// 40 lines (J273): 5 asks, 5 plans, 4 journal lines, 3 of the rest.
describe('session brief: line cap', () => {
  test('a busy repo still gets at most 40 lines, each cut section saying so', () => {
    const repo = realpathSync(fixtureScratch('repo-brief'));
    after(() => rmSync(repo, { recursive: true, force: true }));
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !IDENTITY.test(key))),
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    };
    const git = (...args) => assert.equal(spawnSync('git', args, { cwd: repo, env }).status, 0, args.join(' '));
    const write = (path, text) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    };
    git('init', '-q', '-b', 'main');
    const hooks = relative(ROOT, dirname(BRIEF));
    cpSync(dirname(BRIEF), join(repo, hooks), { recursive: true });
    write('src/scripts/.kit/asks.mjs', readFileSync(join(ROOT, 'src', 'scripts', '.kit', 'asks.mjs'), 'utf8'));
    for (let i = 1; i <= 8; i++) write(`docs/tasks/asks/A${i}.md`, `# A${i}\n\n**Status:** open (2026-11-11)\n**Ask:** ask ${i}\n`);
    for (let i = 1; i <= 9; i++) write(`docs/plans/opus-2026-11-11-p${i}.md`, `# P${i}\n\n> **State:** in progress, 2026-11-11.\n`);
    write('project/journal/2026-11-11.md', `${Array.from({ length: 10 }, (_, i) => `journal line ${i + 1}`).join('\n')}\n`);
    write('src/scripts/.kit/worktree.mjs', '// the plan-worktree tool\n');
    for (const name of ['leftovers-report', 'lane-live']) write(`src/scripts/.kit/${name}.mjs`, readFileSync(join(ROOT, `src/scripts/.kit/${name}.mjs`), 'utf8'));
    for (let i = 4; i <= 7; i++) write(`tmp/lane-${i}/out.log`, 'x\n');
    write('.gitignore', 'tmp/\n');
    for (let i = 1; i <= 3; i++) write(`tmp/lane-${i}/out.log`, 'x\n');
    write('tmp/.disk-line', `${40 * 1024 * 1024} 2 ${Math.floor(Date.now() / 1000)}\n`);
    git('add', '.');
    for (let i = 1; i <= 10; i++) git('commit', '-q', '--allow-empty', '-m', `commit ${i}`);
    for (let i = 1; i <= 5; i++) git('branch', `stray-${i}`);
    for (let i = 1; i <= 6; i++) write(`dirty-${i}.txt`, 'x\n');
    const saved = readFileSync(TERMINALS, 'utf8');
    writeFileSync(TERMINALS, JSON.stringify(Array.from({ length: 7 }, (_, i) => terminal(`t${i}`, repo, { msg: `Peer ${i}` }))));
    after(() => writeFileSync(TERMINALS, saved));
    const result = spawnSync('bash', [join(repo, hooks, 'session-brief.sh')], { encoding: 'utf8', input: '', env: { ...env, HC_TERMINAL_ID: 't0', PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    const out = result.stdout;
    const lines = out.trimEnd().split('\n').length;
    assert.match(out, /left lying around \(manual audit only\)/);
    assert.match(out, /unknown.*lane-1/);
    assert.ok(lines <= 40, `${lines} lines:\n${out}`);
    assert.match(out, /git hooks are OFF/);
    assert.match(out, /-- other agents in this repo \(hc\), first 3 of 6 --\n(  t[1-6] .*\n){3}  They share this checkout/);
    assert.match(out, /-- asks still open \(.*\), first 5 of 8 --\n(  A[1-5] \|.*\n){5}-- live plans/);
    assert.match(out, /-- live plans \(docs\/plans\/\), first 5 of 9 --\n( {2}docs\/plans\/opus-2026-11-11-p[1-5]\.md {2}\(State: in progress, 2026-11-11\.\)\n){5}-- latest journal/);
    assert.match(out, /-- latest journal: project\/journal\/2026-11-11\.md \(last lines\) --\n( {4}journal line (9|10)\n){2}-- main only/);
    assert.match(out, /( {2}!! branch stray-[1-3]\n){3} {2}!! Not main-only \(5 in all\)/);
    assert.match(out, /-- uncommitted in this checkout .*, first 2 of 6 --/);
    assert.match(out, /-- recent commits --\n {2}[0-9a-f]+ commit 10\n/);
    assert.match(out, /^-- \.\/tmp is 40\.0 GiB in 7 folders; 2 over 3 days; 7 without an owner .* !! over 30 GiB/m);
  });
});

// REPO-DISK DK7: one ./tmp line (size, folders, folders over 3 days,
// folders without an owner) and a warning over 30 GiB. The size walk
// runs off the brief's hot path; WS_TMP_MEASURE=sync runs it inline and
// WS_TMP_FAKE_KIB stands in for du's total.
describe('session brief: ./tmp line', () => {
  const GIB = 1024 * 1024;
  const repoWithTmp = ({ folders = true } = {}) => {
    const repo = realpathSync(fixtureScratch('repo-brief-tmp'));
    after(() => rmSync(repo, { recursive: true, force: true }));
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    const hooks = relative(ROOT, dirname(BRIEF));
    cpSync(dirname(BRIEF), join(repo, hooks), { recursive: true });
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const folder = (name, { owner = false, keep = false, stale = false } = {}) => {
      const dir = join(repo, 'tmp', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'build.log'), 'x'.repeat(4096));
      if (owner) writeFileSync(join(dir, '.owner'), 'session s1\n');
      if (keep) writeFileSync(join(dir, '.keep'), 'kept for DK7 test\n');
      if (stale) for (const path of [join(dir, 'build.log'), join(dir, '.owner'), join(dir, '.keep'), dir]) {
        try { utimesSync(path, old, old); } catch { /* absent */ }
      }
    };
    if (!folders) return { repo, hooks };
    folder('fresh-owned', { owner: true });
    folder('fresh-bare');
    folder('old-bare', { stale: true });
    folder('old-kept', { owner: true, keep: true, stale: true });
    return { repo, hooks };
  };
  const run = ({ repo, hooks }, env = {}) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('WS_TMP_') && !IDENTITY.test(key)));
    const started = Date.now();
    const result = spawnSync('bash', [join(repo, hooks, 'session-brief.sh')], { encoding: 'utf8', env: { ...clean, ...env }, input: '', timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return { out: result.stdout, ms: Date.now() - started };
  };

  test('measured inline: size, folders, over 3 days (not .keep), without an owner', () => {
    const { out } = run(repoWithTmp(), { WS_TMP_MEASURE: 'sync' });
    assert.match(out, /^-- \.\/tmp is 0\.0 GiB in 4 folders; 1 over 3 days; 2 without an owner \(size and age measured 0 min ago\) --$/m);
    assert.doesNotMatch(out, /over 30 GiB/);
  });
  test('over 30 GiB (fake size) warns', () => {
    const { out } = run(repoWithTmp(), { WS_TMP_MEASURE: 'sync', WS_TMP_FAKE_KIB: String(31 * GIB) });
    assert.match(out, /^-- \.\/tmp is 31\.0 GiB in 4 folders; 1 over 3 days; 2 without an owner \(size and age measured 0 min ago\) -- !! over 30 GiB: delete your finished folders/m);
  });
  test('a fresh measurement is read, not redone', () => {
    const fixture = repoWithTmp();
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(fixture.repo, 'tmp', '.disk-line'), `${40 * GIB} 3 ${now - 600}\n`);
    const { out } = run(fixture);
    assert.match(out, /^-- \.\/tmp is 40\.0 GiB in 4 folders; 3 over 3 days; 2 without an owner \(size and age measured 10 min ago\) -- !! over 30 GiB: delete your finished folders/m);
    assert.equal(readFileSync(join(fixture.repo, 'tmp', '.disk-line'), 'utf8'), `${40 * GIB} 3 ${now - 600}\n`);
  });
  test('no measurement yet: the brief returns at once and a background walk writes one', async () => {
    const fixture = repoWithTmp();
    const { out, ms } = run(fixture, { WS_TMP_FAKE_KIB: String(2 * GIB) });
    assert.match(out, /^-- \.\/tmp has 4 folders; 2 without an owner; size measuring now, the next session shows it --$/m);
    assert.ok(ms < 5000, `brief took ${ms} ms`);
    const line = join(fixture.repo, 'tmp', '.disk-line');
    for (let i = 0; i < 100 && !existsSync(line); i++) await new Promise((done) => setTimeout(done, 100));
    assert.match(readFileSync(line, 'utf8'), new RegExp(`^${2 * GIB} 1 \\d+\\n$`));
    assert.match(run(fixture).out, /^-- \.\/tmp is 2\.0 GiB in 4 folders; 1 over 3 days; 2 without an owner \(size and age measured 0 min ago\) --$/m);
  });
  test('a garbled or octal-looking measurement is measured again, quietly', async () => {
    for (const garbled of ['not a measurement\n', '0899 1 0899\n']) {
      const fixture = repoWithTmp();
      const line = join(fixture.repo, 'tmp', '.disk-line');
      writeFileSync(line, garbled);
      assert.match(run(fixture, { WS_TMP_FAKE_KIB: String(GIB) }).out, /size measuring now/);
      for (let i = 0; i < 100 && !readFileSync(line, 'utf8').startsWith(`${GIB} `); i++) await new Promise((done) => setTimeout(done, 100));
      assert.match(readFileSync(line, 'utf8'), new RegExp(`^${GIB} 1 \\d+\\n$`));
    }
  });
  test('a stray file alone in ./tmp is still measured', () => {
    const fixture = repoWithTmp({ folders: false });
    mkdirSync(join(fixture.repo, 'tmp'));
    writeFileSync(join(fixture.repo, 'tmp', 'core.123'), 'x');
    assert.match(run(fixture, { WS_TMP_MEASURE: 'sync', WS_TMP_FAKE_KIB: String(40 * GIB) }).out, /^-- \.\/tmp is 40\.0 GiB in 0 folders; 0 over 3 days; 0 without an owner .* !! over 30 GiB/m);
  });
  test('nothing in ./tmp: says so in one line', () => {
    assert.match(run(repoWithTmp({ folders: false })).out, /^-- \.\/tmp is empty --$/m);
  });
});
