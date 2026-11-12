// The herdr question guard (meta REPO-KIT-PLAN K3): this repo's installed
// PreToolUse hook, run by the very command its .claude/settings.json (and
// .codex/hooks.json, if any) wires, and its src/scripts/ helpers, against
// a fake `herdr` on PATH. No real pane is read or written.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPERS = ['herdr-question-open.sh', 'herdr-prompt.sh'];
const scratch = join(REPO, 'tmp', `herdr-guard-test-${process.pid}`);
mkdirSync(scratch, { recursive: true });
after(() => rmSync(scratch, { recursive: true, force: true }));

/** The installed guard's command for each tool, as the repo wires it. */
function wired() {
  const out = {};
  const find = (path, tool) => {
    if (!existsSync(join(REPO, path))) return;
    const hooks = JSON.parse(readFileSync(join(REPO, path), 'utf8')).hooks ?? {};
    for (const group of hooks.PreToolUse ?? []) {
      if (group.matcher !== 'Bash') continue;
      for (const hook of group.hooks ?? []) if (/guard-herdr-prompt\.sh/.test(hook.command)) out[tool] = hook.command;
    }
  };
  find('.claude/settings.json', 'claude');
  find('.codex/hooks.json', 'codex');
  return out;
}
const COMMANDS = wired();
const scriptOf = (command) => /\/([^"]*guard-herdr-prompt\.sh)"/.exec(command)?.[1];

// A clean environment: no agent, herdr or git variables from the caller.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|HERDR_|CLAUDE_|SKIP_)/.test(key)));

// A fake herdr (bash and jq, so each call is cheap): panes come from
// $FAKE_HERDR_STATE, writes are logged to $FAKE_HERDR_LOG, and errors go
// to stderr as herdr's do.
const FAKE = String.raw`#!/usr/bin/env bash
state="$FAKE_HERDR_STATE" group="$1" verb="$2" target="$3"
jq -e '.down' "$state" >/dev/null && exit 1
find() { jq -c --arg t "$target" "[.panes[] | select($1)][0] // empty" "$state"; }
case "$group $verb" in
  "agent get")
    p="$(find '.agent and (.pane_id == $t or .name == $t)')"
    [ -n "$p" ] || { echo '{"error":{"code":"agent_not_found"}}' >&2; exit 1; }
    jq -e '.statusFails' <<<"$p" >/dev/null && { echo 'not json'; exit 0; }
    jq -c '{result: {agent: {pane_id, agent, agent_status, name}}}' <<<"$p" ;;
  "pane get")
    p="$(find '.pane_id == $t')"
    [ -n "$p" ] || { echo '{"error":{"code":"pane_not_found"}}' >&2; exit 1; }
    jq -e '.statusFails' <<<"$p" >/dev/null && { echo 'not json'; exit 0; }
    jq -c '{result: {pane: {pane_id, agent: (.agent // null), agent_status: (if .agent then .agent_status else null end)}}}' <<<"$p" ;;
  "pane read")
    p="$(find '.pane_id == $t')"
    [ -n "$p" ] || exit 1
    jq -e '.readFails' <<<"$p" >/dev/null && exit 1
    jq -j '.screen' <<<"$p" ;;
  "agent prompt" | "agent send-keys" | "pane send-text" | "pane send-keys" | "pane run")
    printf '%s\0' "$@" | jq -sRc 'split("\u0000")[:-1]' >>"$FAKE_HERDR_LOG" ;;
esac
exit 0
`;

const PANES = [
  { pane_id: 'w1:p1', name: 'lane-a', agent: 'claude', agent_status: 'idle', screen: '> ready\n' },
  { pane_id: 'w1:p2', name: 'jake-q', agent: 'claude', agent_status: 'working', screen: 'Which one?\nEnter to select · ↑/↓ to navigate\n' },
  { pane_id: 'w1:p3', name: 'approver', agent: 'codex', agent_status: 'blocked', screen: 'running\n' },
  { pane_id: 'w1:p4', screen: '$ \n' },
  { pane_id: 'w1:p5', name: 'mute', agent: 'claude', agent_status: 'idle', screen: '', statusFails: true },
  { pane_id: 'w1:p6', name: 'blind', agent: 'claude', agent_status: 'idle', screen: '', readFails: true },
  { pane_id: 'w1:p7', name: 'two words', agent: 'claude', agent_status: 'idle', screen: '> ready\n' },
  { pane_id: 'w1:p8', name: 'wildshard-v', agent: 'claude', agent_status: 'idle', screen: '> ready\n' },
];

/** A git repo holding the installed guard and helpers at their real paths, plus a fake herdr. */
function box({ state = { panes: PANES } } = {}) {
  const root = realpathSync(mkdtempSync(join(scratch, 'box-')));
  const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: ENV });
  run(['init', '-q', '-b', 'main']);
  for (const command of Object.values(COMMANDS)) {
    const script = scriptOf(command);
    mkdirSync(dirname(join(root, script)), { recursive: true });
    cpSync(join(REPO, script), join(root, script));
  }
  mkdirSync(join(root, 'src', 'scripts'), { recursive: true });
  for (const name of HELPERS) cpSync(join(REPO, 'src', 'scripts', name), join(root, 'src', 'scripts', name));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'herdr'), FAKE);
  chmodSync(join(root, 'bin', 'herdr'), 0o755);
  writeFileSync(join(root, 'state.json'), JSON.stringify(state));
  writeFileSync(join(root, 'writes.log'), '');
  const env = { ...ENV, PATH: `${join(root, 'bin')}:${ENV.PATH}`, FAKE_HERDR_STATE: join(root, 'state.json'), FAKE_HERDR_LOG: join(root, 'writes.log') };
  /** The wired hook for one tool on a Bash payload; Codex runs from a subfolder, with no CLAUDE_PROJECT_DIR. */
  const hookArgs = (command, tool, extra) => {
    const cwd = tool === 'codex' ? join(root, 'bin') : root;
    const payload = { session_id: 's', hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command } };
    const vars = tool === 'claude' ? { CLAUDE_PROJECT_DIR: root } : {};
    return { argv: ['-c', COMMANDS[tool]], input: JSON.stringify(payload), options: { cwd, env: { ...env, ...vars, ...extra } } };
  };
  const hook = (command, tool = 'claude', extra = {}) => {
    const { argv, input, options } = hookArgs(command, tool, extra);
    const result = spawnSync('bash', argv, { ...options, input, encoding: 'utf8' });
    return { status: result.status, stderr: result.stderr };
  };
  /** Many hook runs, eight at a time: [{ command, tool }] -> [{ command, tool, status, stderr }]. */
  const hooks = async (runs) => {
    const out = [];
    const one = ({ command, tool }) =>
      new Promise((done) => {
        const { argv, input, options } = hookArgs(command, tool, {});
        const child = spawn('bash', argv, options);
        let stderr = '';
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.stdout.resume();
        child.on('close', (status) => done({ command, tool, status, stderr }));
        child.stdin.end(input);
      });
    for (let k = 0; k < runs.length; k += 8) out.push(...(await Promise.all(runs.slice(k, k + 8).map(one))));
    return out;
  };
  const script = (name, args, extra = {}) => spawnSync(join(root, 'src', 'scripts', name), args, { cwd: root, encoding: 'utf8', env: { ...env, ...extra } });
  const writes = () => readFileSync(join(root, 'writes.log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { root, env, hook, hooks, script, writes };
}

const QUOTES = { unquoted: (t) => (/\s/.test(t) ? null : t), single: (t) => `'${t}'`, double: (t) => `"${t}"` };
/** Every herdr write form, for an agent-name target and a pane-id target. */
const FORMS = [
  (agent) => `herdr agent prompt ${agent} "hello there"`,
  (agent) => `cd /tmp && herdr agent prompt ${agent} 'hi' --wait --until idle`,
  (agent) => `herdr agent send-keys ${agent} Enter`,
  (_agent, pane) => `herdr pane send-text ${pane} 'hi'`,
  (_agent, pane) => `herdr pane send-keys ${pane} Enter`,
  (_agent, pane) => `herdr pane run ${pane} "echo hi"; echo done`,
  (agent) => `bash -c "herdr agent prompt ${agent.replaceAll('"', "'")} hi"`,
  // Command substitution runs inside double quotes, and inside single quotes handed to bash -c (K7 review MUST).
  (agent) => `echo "sent: $(herdr agent prompt ${agent} hi)"`,
  (agent) => `bash -c 'echo $(herdr agent prompt ${agent.replaceAll("'", '"')} hi)'`,
  (agent) => `x="\`herdr agent send-keys ${agent.replaceAll('"', "'")} Enter\`"`,
];
const commands = (agent, pane) => {
  const out = [];
  for (const [style, quote] of Object.entries(QUOTES)) {
    const [a, p] = [quote(agent), quote(pane)];
    if (a === null) continue;
    for (const form of FORMS) out.push({ style, command: form(a, p) });
  }
  return out;
};
const tools = () => Object.keys(COMMANDS);

describe('herdr question guard (K3)', () => {
  test('is installed and wired in settings', () => {
    assert.ok(COMMANDS.claude, '.claude/settings.json runs no guard-herdr-prompt.sh on Bash');
    for (const command of Object.values(COMMANDS)) assert.ok(existsSync(join(REPO, scriptOf(command))), command);
    for (const name of HELPERS) assert.ok(existsSync(join(REPO, 'src', 'scripts', name)), name);
  });

  test('an open question blocks every form, quoted or not', async () => {
    const b = box();
    for (const [agent, pane, why] of [['jake-q', 'w1:p2', /showing a question/], ['approver', 'w1:p3', /is blocked/]]) {
      const runs = tools().flatMap((tool) => commands(agent, pane).map(({ command }) => ({ command, tool })));
      for (const result of await b.hooks(runs)) {
        assert.equal(result.status, 2, `${result.tool}: ${result.command}`);
        assert.match(result.stderr, why, result.command);
      }
    }
  });

  test('a clear target permits every valid form, quoted or not', async () => {
    const b = box();
    for (const [agent, pane] of [['lane-a', 'w1:p1'], ['two words', 'w1:p7'], ['lane-a', 'w1:p4']]) {
      const runs = tools().flatMap((tool) => commands(agent, pane).map(({ command }) => ({ command, tool })));
      for (const result of await b.hooks(runs)) assert.equal(result.status, 0, `${result.tool}: ${result.command}\n${result.stderr}`);
    }
  });

  test('unresolved targets and unavailable inspection refuse', async () => {
    const cases = [
      ['ghost', 'w9:p9', /does not resolve/],
      ['mute', 'w1:p5', /could not be read|no readable status/],
      ['blind', 'w1:p6', /screen could not be read/],
      ['$TARGET', '$PANE', /does not resolve/],
    ];
    const b = box();
    for (const [agent, pane, why] of cases) {
      const runs = tools().flatMap((tool) => commands(agent, pane).map(({ command }) => ({ command, tool })));
      for (const result of await b.hooks(runs)) {
        assert.equal(result.status, 2, `${result.tool}: ${result.command}`);
        assert.match(result.stderr, why, result.command);
      }
    }
    const down = box({ state: { down: true, panes: PANES } });
    assert.match(down.hook('herdr agent prompt "lane-a" hi').stderr, /unavailable: lane-a could not be read/);
    assert.equal(down.hook('herdr agent prompt "lane-a" hi').status, 2);
    // node alone on PATH (beside the system tools): herdr is gone.
    mkdirSync(join(b.root, 'node-only'));
    symlinkSync(process.execPath, join(b.root, 'node-only', 'node'));
    const noHerdr = b.hook("herdr pane run 'w1:p1' ls", 'claude', { PATH: `${join(b.root, 'node-only')}:/usr/bin:/bin` });
    assert.equal(noHerdr.status, 2);
    assert.match(noHerdr.stderr, /herdr is not on PATH|jq is not on PATH/);
    assert.match(b.hook('herdr --session other agent prompt lane-a hi').stderr, /another session/);
    assert.match(b.hook('herdr agent prompt').stderr, /has no target/);
  });

  test('a missing or non-executable helper refuses writes', () => {
    for (const name of HELPERS) {
      const gone = box();
      rmSync(join(gone.root, 'src', 'scripts', name));
      for (const tool of tools()) {
        const result = gone.hook('herdr agent prompt lane-a hi', tool);
        assert.equal(result.status, 2, `${tool} without ${name}`);
        assert.match(result.stderr, new RegExp(`${name} is missing or not executable`));
      }
      const flat = box();
      chmodSync(join(flat.root, 'src', 'scripts', name), 0o644);
      assert.equal(flat.hook("herdr pane send-text 'w1:p1' hi").status, 2, `${name} not executable`);
    }
  });

  test('a herdr write inside any command substitution the shell runs is refused (K7 review MUST)', async () => {
    const b = box();
    const runs = [
      'echo "$(herdr agent prompt jake-q hi)"',
      'echo "a $(echo "$(herdr agent prompt jake-q hi)")"',
      'git commit -m "$(herdr agent prompt jake-q hi)" -- a',
      `x="$(cd /tmp && herdr pane send-text 'w1:p3' hi)"`,
      'echo "`herdr agent prompt jake-q hi`"',
      'echo `herdr agent prompt jake-q hi`',
      'bash -c "echo $(herdr agent prompt jake-q hi)"',
      `bash -c 'echo $(herdr agent prompt jake-q hi)'`,
      "bash -c 'echo `herdr agent prompt jake-q hi`'",
      `sh -lc 'echo "$(herdr pane send-keys w1:p3 Enter)"'`,
      String.raw`eval "echo \$(herdr agent prompt jake-q hi)"`,
      `watch 'echo $(herdr agent prompt jake-q hi)'`,
      'echo "$(printf %s "$(herdr agent prompt "jake-q" hi)")"',
    ].flatMap((command) => tools().map((tool) => ({ command, tool })));
    for (const result of await b.hooks(runs)) {
      assert.equal(result.status, 2, `${result.tool}: ${result.command}\n${result.stderr}`);
      assert.match(result.stderr, /showing a question|is blocked/, result.command);
    }
  });

  test('text the shell only prints, never runs, passes (K7 review SHOULD)', async () => {
    const b = box();
    const runs = [
      'echo "herdr agent prompt jake-q hi"',
      'echo herdr agent prompt jake-q hi',
      String.raw`printf '%s\n' 'herdr pane send-text w1:p3 hi'`,
      'grep -n "herdr agent prompt jake-q" docs/x.md',
      `echo '$(herdr agent prompt jake-q hi)'`,
      "echo '`herdr agent prompt jake-q hi`'",
      String.raw`echo "\$(herdr agent prompt jake-q hi)"`,
      `bash -c 'echo "herdr agent prompt jake-q hi"'`,
    ].flatMap((command) => tools().map((tool) => ({ command, tool })));
    for (const result of await b.hooks(runs)) assert.equal(result.status, 0, `${result.tool}: ${result.command}\n${result.stderr}`);
  });

  test('reads, other herdr commands, mentions and the escape pass', () => {
    const b = box();
    for (const command of ['herdr agent list', 'herdr pane read w1:p2 --source visible', 'herdr agent get jake-q', 'git commit -m "guard herdr agent prompt jake-q" -- a', 'grep -n herdr docs/x.md', 'ls']) {
      assert.equal(b.hook(command).status, 0, command);
    }
    assert.equal(b.hook('SKIP_HERDR_GUARD=1 herdr agent prompt jake-q hi').status, 0);
  });

  test('wildshard-v is an ordinary target now', () => {
    assert.equal(box().hook("herdr agent prompt 'wildshard-v' hi").status, 0);
  });

  test('the helper tells clear, blocked and unavailable apart', () => {
    const b = box();
    const expect = { 'lane-a': [1, /^clear: /], 'w1:p4': [1, /^clear: .*plain pane/], 'jake-q': [0, /^blocked: /], approver: [0, /^blocked: /], ghost: [3, /^unavailable: .*does not resolve/], mute: [3, /^unavailable: /], blind: [3, /^unavailable: /] };
    for (const [target, [status, out]] of Object.entries(expect)) {
      const result = b.script('herdr-question-open.sh', [target]);
      assert.equal(result.status, status, target);
      assert.match(result.stdout, out, target);
    }
    assert.equal(b.script('herdr-question-open.sh', []).status, 2);
  });

  test('the wrapper writes only to a clear target, through the same helper', () => {
    const b = box();
    assert.equal(b.script('herdr-prompt.sh', ['lane-a', 'hello']).status, 0);
    assert.equal(b.script('herdr-prompt.sh', ['pane', 'run', 'w1:p4', 'echo hi']).status, 0);
    assert.equal(b.script('herdr-prompt.sh', ['agent', 'prompt', 'two words', 'hi', '--wait']).status, 0);
    assert.deepEqual(b.writes(), [['agent', 'prompt', 'lane-a', 'hello'], ['pane', 'run', 'w1:p4', 'echo hi'], ['agent', 'prompt', 'two words', 'hi', '--wait']]);
    for (const args of [['jake-q', 'hi'], ['pane', 'send-text', 'w1:p3', 'hi'], ['ghost', 'hi'], ['pane', 'send-keys', 'w1:p6', 'Enter'], ['mute', 'hi']]) {
      const result = b.script('herdr-prompt.sh', args);
      assert.equal(result.status, 3, args.join(' '));
      assert.match(result.stderr, /not sent: (blocked|unavailable): /, args.join(' '));
    }
    rmSync(join(b.root, 'src', 'scripts', 'herdr-question-open.sh'));
    const missing = b.script('herdr-prompt.sh', ['lane-a', 'hi']);
    assert.equal(missing.status, 3);
    assert.match(missing.stderr, /missing or not executable/);
    assert.equal(b.writes().length, 3, 'a refused write reached herdr');
  });
});
