// Tests for the herdr section of .claude/hooks/session-brief.sh, with a
// fake `herdr` on PATH that prints a canned `herdr agent list`.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEF = join(ROOT, '.claude', 'hooks', 'session-brief.sh');
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
