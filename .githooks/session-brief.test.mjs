// Tests for the herdr section of the session brief hook, with a
// fake `herdr` on PATH that prints a canned `herdr agent list`.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The agent layout (repo-kit agent-sync) keeps hook scripts in .agents/hooks/;
// a repo not yet stamped keeps them in .claude/hooks/.
const hookScript = (root, name) => ['.agents', '.claude'].map((dir) => join(root, dir, 'hooks', name)).find((path) => existsSync(path)) ?? join(root, '.claude', 'hooks', name);
const BRIEF = hookScript(ROOT, 'session-brief.sh');
const bin = mkdtempSync(join(tmpdir(), 'repo-herdr-'));
after(() => rmSync(bin, { recursive: true, force: true }));

const agent = (pane, session, cwd, extra = {}) => ({
  pane_id: pane, agent: 'claude', agent_status: 'working', cwd, foreground_cwd: cwd,
  agent_session: { value: session }, tokens: {}, terminal_title_stripped: '', ...extra,
});
writeFileSync(join(bin, 'agents.json'), JSON.stringify({ result: { agents: [
  agent('w1:p1', 'me', ROOT, { terminal_title_stripped: 'Me, myself' }),
  agent('w1:p2', 'peer', ROOT, { agent_status: 'idle', terminal_title_stripped: '⠐ Build the queue view' }),
  agent('w1:p3', 'wt', join(ROOT, '.claude/worktrees/agent-x/src'), { tokens: { goal: 'scaffold' } }),
  agent('w1:p4', 'bare', join(ROOT, 'docs')),
  agent('w2:p1', 'elsewhere', '/Users/someone/other-repo', { terminal_title_stripped: 'Other repo' }),
] } }));
writeFileSync(join(bin, 'herdr'), `#!/usr/bin/env bash\n[ "$1 $2" = "agent list" ] && cat "${join(bin, 'agents.json')}"\n`);
chmodSync(join(bin, 'herdr'), 0o755);

const brief = (env, input = '') => {
  const clean = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !['HERDR_ENV', 'HERDR_PANE_ID', 'CLAUDE_CODE_SESSION_ID'].includes(key)));
  const result = spawnSync('bash', [BRIEF], { input, encoding: 'utf8', env: { ...clean, PATH: `${bin}:${process.env.PATH}`, ...env } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('-- live plans')[0];
};

describe('session brief: herdr peers', () => {
  test('lists the other agents in this repo, not self or other repos', () => {
    const out = brief({ HERDR_ENV: '1', CLAUDE_CODE_SESSION_ID: 'me' });
    assert.match(out, /w1:p2 {2}idle {2}Build the queue view {2}\[main\]/);
    assert.match(out, /w1:p3 {2}working {2}scaffold {2}\[\.claude\/worktrees\/agent-x\]/);
    assert.match(out, /w1:p4 {2}working {2}\(no goal set\) {2}\[main\]/);
    assert.match(out, /commit only your own paths/);
    assert.doesNotMatch(out, /Me, myself|Other repo/);
  });
  test('reads its own session id from the SessionStart JSON on stdin', () => {
    const out = brief({ HERDR_ENV: '1' }, JSON.stringify({ session_id: 'me', hook_event_name: 'SessionStart' }));
    assert.doesNotMatch(out, /Me, myself/);
    assert.match(out, /Build the queue view/);
  });
  test('says so when not inside herdr', () => {
    assert.match(brief({}), /\(not running inside herdr\)/);
  });
  test('says so when it is the only agent', () => {
    writeFileSync(join(bin, 'agents.json'), JSON.stringify({ result: { agents: [agent('w1:p1', 'me', ROOT)] } }));
    assert.match(brief({ HERDR_ENV: '1', CLAUDE_CODE_SESSION_ID: 'me' }), /you're the only agent here/);
  });
});

// K2: the brief lists each live plan with its State line, in a real
// temporary git repo that holds a copy of this repo's hook folder.
describe('session brief: live plans', () => {
  const plans = (files) => {
    const repo = mkdtempSync(join(tmpdir(), 'repo-brief-'));
    after(() => rmSync(repo, { recursive: true, force: true }));
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    const hooks = relative(ROOT, dirname(BRIEF));
    cpSync(dirname(BRIEF), join(repo, hooks), { recursive: true });
    mkdirSync(join(repo, 'docs', 'plans'), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, 'docs', 'plans', name), text);
    const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'HERDR_ENV'));
    const result = spawnSync('bash', [join(repo, hooks, 'session-brief.sh')], { encoding: 'utf8', env: clean, input: '' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split('-- live plans')[1].split('-- latest journal')[0];
  };
  test('shows a quoted bold State line, a plain one, and an old Status line', () => {
    const out = plans({
      'opus-2026-11-07-a.md': '# A\n\n> Written by: Claude\n\n> **State:** ready for review, 2026-11-07.\n\nStatus: not this one\n',
      'opus-2026-11-07-b.md': '# B\n\nState: draft, parked, 2026-11-07: for December.\n',
      'opus-2026-11-04-old.md': '# Old\n\nStatus: in progress 2026-11-04\n',
      'README.md': '# Plans\n\n> **State:** living index.\n',
    });
    assert.match(out, /docs\/plans\/opus-2026-11-07-a\.md {2}\(State: ready for review, 2026-11-07\.\)/);
    assert.match(out, /docs\/plans\/opus-2026-11-07-b\.md {2}\(State: draft, parked, 2026-11-07: for December\.\)/);
    assert.match(out, /docs\/plans\/opus-2026-11-04-old\.md {2}\(Status: in progress 2026-11-04\)/);
    assert.doesNotMatch(out, /README|not this one/);
  });
  test('a plan with no state line is listed bare', () => {
    assert.match(plans({ 'opus-2026-11-07-c.md': '# C\n\nbody\n' }), /docs\/plans\/opus-2026-11-07-c\.md\n/);
  });
});

// K4: the brief lands in every session's context, so it stays within
// 40 lines (J273): 5 asks, 5 plans, 4 journal lines, 3 of the rest.
describe('session brief: line cap', () => {
  test('a busy repo still gets at most 40 lines, each cut section saying so', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'repo-brief-')));
    after(() => rmSync(repo, { recursive: true, force: true }));
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !['HERDR_ENV', 'HERDR_PANE_ID', 'CLAUDE_CODE_SESSION_ID'].includes(key))),
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
    write('src/scripts/asks.mjs', readFileSync(join(ROOT, 'src', 'scripts', 'asks.mjs'), 'utf8'));
    for (let i = 1; i <= 8; i++) write(`docs/tasks/asks/A${i}.md`, `# A${i}\n\n**Status:** open (2026-11-11)\n**Ask:** ask ${i}\n`);
    for (let i = 1; i <= 9; i++) write(`docs/plans/opus-2026-11-11-p${i}.md`, `# P${i}\n\n> **State:** in progress, 2026-11-11.\n`);
    write('project/journal/2026-11-11.md', `${Array.from({ length: 10 }, (_, i) => `journal line ${i + 1}`).join('\n')}\n`);
    git('add', '.');
    for (let i = 1; i <= 10; i++) git('commit', '-q', '--allow-empty', '-m', `commit ${i}`);
    for (let i = 1; i <= 5; i++) git('branch', `stray-${i}`);
    for (let i = 1; i <= 6; i++) write(`dirty-${i}.txt`, 'x\n');
    writeFileSync(join(bin, 'agents.json'), JSON.stringify({ result: { agents: Array.from({ length: 7 }, (_, i) => agent(`w1:p${i}`, `s${i}`, repo, { terminal_title_stripped: `Peer ${i}` })) } }));
    const result = spawnSync('bash', [join(repo, hooks, 'session-brief.sh')], { encoding: 'utf8', input: '', env: { ...env, HERDR_ENV: '1', CLAUDE_CODE_SESSION_ID: 's0', PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    const out = result.stdout;
    const lines = out.trimEnd().split('\n').length;
    assert.ok(lines <= 40, `${lines} lines:\n${out}`);
    assert.match(out, /git hooks are OFF/);
    assert.match(out, /-- other agents in this repo \(herdr\), first 3 of 6 --\n(  w1:p[1-3] .*\n){3}  They share this checkout/);
    assert.match(out, /-- asks still open \(.*\), first 5 of 8 --\n(  A[1-5] \|.*\n){5}-- live plans/);
    assert.match(out, /-- live plans \(docs\/plans\/\), first 5 of 9 --\n( {2}docs\/plans\/opus-2026-11-11-p[1-5]\.md {2}\(State: in progress, 2026-11-11\.\)\n){5}-- latest journal/);
    assert.match(out, /-- latest journal: project\/journal\/2026-11-11\.md \(last lines\) --\n( {4}journal line (7|8|9|10)\n){4}-- main only/);
    assert.match(out, /( {2}!! branch stray-[1-3]\n){3} {2}!! Not main-only \(5 in all\)/);
    assert.match(out, /-- uncommitted in this checkout .*, first 3 of 6 --/);
    assert.match(out, /-- recent commits --\n {2}[0-9a-f]+ commit 10\n/);
  });
});
