// The hc question guard (meta REPO-KIT-PLAN K3, ported from herdr to
// herdr-core): this repo's installed PreToolUse hook, run by the very command
// its .claude/settings.json (and .codex/hooks.json, if any) wires, against a
// fake `hc` on PATH. No real terminal is read or written.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(REPO, 'tmp', `hc-guard-test-${process.pid}`);
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
      for (const hook of group.hooks ?? []) if (/guard-hc-send\.sh/.test(hook.command)) out[tool] = hook.command;
    }
  };
  find('.claude/settings.json', 'claude');
  find('.codex/hooks.json', 'codex');
  return out;
}
const COMMANDS = wired();
const scriptOf = (command) => /\/([^"]*guard-hc-send\.sh)"/.exec(command)?.[1];

// A clean environment: no agent, hc, herdr or git variables from the caller.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|HC_|HERDR_|CLAUDE_|SKIP_)/.test(key)));

// A fake hc (bash and jq, so each call is cheap): terminals come from
// $FAKE_HC_STATE, any call that is not a read is logged to $FAKE_HC_LOG,
// and errors go to stderr as hc's do (3: not_found).
const FAKE = String.raw`#!/usr/bin/env bash
state="$FAKE_HC_STATE"
jq -e '.down' "$state" >/dev/null && { echo '{"error":{"kind":"unavailable"}}' >&2; exit 1; }
case "$1" in
  get)
    r="$(jq -c --arg t "$2" '[.terminals[] | select(.address == $t or .name == $t)][0] // empty' "$state")"
    [ -n "$r" ] || { echo '{"error":{"kind":"not_found"}}' >&2; exit 3; }
    jq -e '.unreadable' <<<"$r" >/dev/null && { echo 'not json'; exit 0; }
    echo "$r" ;;
  ls) jq -c '{terminals: [.terminals[] | {address, agent, state}]}' "$state" ;;
  *) printf '%s\0' "$@" | jq -sRc 'split("\u0000")[:-1]' >>"$FAKE_HC_LOG" ;;
esac
exit 0
`;

const working = (msg) => ({ app: 'claude-code', msg, state: 'working' });
const TERMINALS = [
  { address: 't1', name: 'lane-a', agent: 'claude-code', state: 'live', status: working('building') },
  { address: 't2', name: 'jake-q', agent: 'claude-code', state: 'live', status: { app: 'claude-code', msg: 'Which one?', state: 'blocked' } },
  { address: 't3', name: 'approver', agent: 'codex', state: 'live', status: 'blocked' },
  { address: 't4', agent: 'bash', state: 'live' },
  { address: 't5', name: 'mute', agent: 'claude-code', state: 'live', unreadable: true },
  { address: 't6', name: 'gone', agent: 'claude-code', state: 'finished' },
  { address: 't7', name: 'two words', agent: 'claude-code', state: 'live', status: working('idle soon') },
];

/** A git repo holding the installed guard at its real path, plus a fake hc. */
function box({ state = { terminals: TERMINALS } } = {}) {
  const root = realpathSync(mkdtempSync(join(scratch, 'box-')));
  const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: ENV });
  run(['init', '-q', '-b', 'main']);
  for (const command of Object.values(COMMANDS)) {
    const script = scriptOf(command);
    mkdirSync(dirname(join(root, script)), { recursive: true });
    cpSync(join(REPO, script), join(root, script));
  }
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'hc'), FAKE);
  chmodSync(join(root, 'bin', 'hc'), 0o755);
  writeFileSync(join(root, 'state.json'), JSON.stringify(state));
  writeFileSync(join(root, 'calls.log'), '');
  const env = { ...ENV, PATH: `${join(root, 'bin')}:${ENV.PATH}`, FAKE_HC_STATE: join(root, 'state.json'), FAKE_HC_LOG: join(root, 'calls.log') };
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
  const calls = () => readFileSync(join(root, 'calls.log'), 'utf8').split('\n').filter(Boolean);
  return { root, env, hook, hooks, calls };
}

const QUOTES = { unquoted: (t) => (/\s/.test(t) ? null : t), single: (t) => `'${t}'`, double: (t) => `"${t}"` };
/** Every checked hc write form (keys, interrupt), for a name target and an address target. */
const FORMS = [
  (name) => `hc keys ${name} down enter`,
  (name) => `cd /tmp && hc keys --json ${name} enter`,
  (_name, address) => `hc interrupt ${address}`,
  (_name, address) => `hc keys ${address} esc; echo done`,
  (name) => `bash -c "hc keys ${name.replaceAll('"', "'")} enter"`,
  // Command substitution runs inside double quotes, and inside single quotes handed to bash -c (K7 review MUST).
  (name) => `echo "sent: $(hc keys ${name} enter)"`,
  (name) => `bash -c 'echo $(hc keys ${name.replaceAll("'", '"')} enter)'`,
  (name) => `x="\`hc interrupt ${name.replaceAll('"', "'")}\`"`,
];
const commands = (name, address) => {
  const out = [];
  for (const [style, quote] of Object.entries(QUOTES)) {
    const [n, a] = [quote(name), quote(address)];
    if (n === null) continue;
    for (const form of FORMS) out.push({ style, command: form(n, a) });
  }
  return out;
};
const tools = () => Object.keys(COMMANDS);

describe('hc question guard (K3)', () => {
  test('is installed and wired in settings', () => {
    assert.ok(COMMANDS.claude, '.claude/settings.json runs no guard-hc-send.sh on Bash');
    for (const command of Object.values(COMMANDS)) assert.ok(existsSync(join(REPO, scriptOf(command))), command);
  });

  test('an open question blocks every checked form, quoted or not', async () => {
    const b = box();
    for (const [name, address] of [['jake-q', 't2'], ['approver', 't3']]) {
      const runs = tools().flatMap((tool) => commands(name, address).map(({ command }) => ({ command, tool })));
      for (const result of await b.hooks(runs)) {
        assert.equal(result.status, 2, `${result.tool}: ${result.command}`);
        assert.match(result.stderr, /is blocked/, result.command);
      }
    }
  });

  test('a clear target permits every checked form, quoted or not', async () => {
    const b = box();
    for (const [name, address] of [['lane-a', 't1'], ['two words', 't7'], ['lane-a', 't4']]) {
      const runs = tools().flatMap((tool) => commands(name, address).map(({ command }) => ({ command, tool })));
      for (const result of await b.hooks(runs)) assert.equal(result.status, 0, `${result.tool}: ${result.command}\n${result.stderr}`);
    }
  });

  test('hc send is left to hc, which refuses a blocked terminal; --force is refused', () => {
    const b = box();
    for (const command of ['hc send jake-q "hello"', 'hc send --wait t2 hi', "hc send --if idle 'two words' hi"]) assert.equal(b.hook(command).status, 0, command);
    for (const command of ['hc send --force lane-a hi', 'hc send t1 hi --force', 'echo "$(hc send --force t2 hi)"']) {
      const result = b.hook(command);
      assert.equal(result.status, 2, command);
      assert.match(result.stderr, /--force types into a blocked terminal/, command);
    }
  });

  test('unresolved, unreadable and finished targets, and no hc, refuse', async () => {
    const cases = [
      ['ghost', 't9', /cannot read/],
      ['mute', 't5', /could not be read/],
      ['gone', 't6', /is finished, not live/],
      ['$TARGET', '$T', /cannot read/],
    ];
    const b = box();
    for (const [name, address, why] of cases) {
      const runs = tools().flatMap((tool) => commands(name, address).map(({ command }) => ({ command, tool })));
      for (const result of await b.hooks(runs)) {
        assert.equal(result.status, 2, `${result.tool}: ${result.command}`);
        assert.match(result.stderr, why, result.command);
      }
    }
    const down = box({ state: { down: true, terminals: TERMINALS } });
    assert.equal(down.hook('hc keys lane-a enter').status, 2);
    assert.match(down.hook('hc keys lane-a enter').stderr, /cannot read lane-a/);
    // node alone on PATH (beside the system tools): hc is gone.
    mkdirSync(join(b.root, 'node-only'));
    symlinkSync(process.execPath, join(b.root, 'node-only', 'node'));
    const noHc = b.hook('hc keys t1 enter', 'claude', { PATH: `${join(b.root, 'node-only')}:/usr/bin:/bin` });
    assert.equal(noHc.status, 2);
    assert.match(noHc.stderr, /hc is not on PATH|jq is not on PATH/);
    assert.match(b.hook('hc keys').stderr, /has no target/);
  });

  test('a checked write inside any command substitution the shell runs is refused (K7 review MUST)', async () => {
    const b = box();
    const runs = [
      'echo "$(hc keys jake-q enter)"',
      'echo "a $(echo "$(hc keys jake-q enter)")"',
      'git commit -m "$(hc interrupt jake-q)" -- a',
      `x="$(cd /tmp && hc keys 't3' enter)"`,
      'echo "`hc keys jake-q enter`"',
      'echo `hc keys jake-q enter`',
      'bash -c "echo $(hc keys jake-q enter)"',
      `bash -c 'echo $(hc keys jake-q enter)'`,
      "bash -c 'echo `hc keys jake-q enter`'",
      `sh -lc 'echo "$(hc interrupt t3)"'`,
      String.raw`eval "echo \$(hc keys jake-q enter)"`,
      `watch 'echo $(hc keys jake-q enter)'`,
      'echo "$(printf %s "$(hc keys "jake-q" enter)")"',
    ].flatMap((command) => tools().map((tool) => ({ command, tool })));
    for (const result of await b.hooks(runs)) {
      assert.equal(result.status, 2, `${result.tool}: ${result.command}\n${result.stderr}`);
      assert.match(result.stderr, /is blocked/, result.command);
    }
  });

  test('text the shell only prints, never runs, passes (K7 review SHOULD)', async () => {
    const b = box();
    const runs = [
      'echo "hc keys jake-q enter"',
      'echo hc keys jake-q enter',
      String.raw`printf '%s\n' 'hc interrupt t3'`,
      'grep -n "hc keys jake-q" docs/x.md',
      `echo '$(hc keys jake-q enter)'`,
      "echo '`hc keys jake-q enter`'",
      String.raw`echo "\$(hc keys jake-q enter)"`,
      `bash -c 'echo "hc keys jake-q enter"'`,
    ].flatMap((command) => tools().map((tool) => ({ command, tool })));
    for (const result of await b.hooks(runs)) assert.equal(result.status, 0, `${result.tool}: ${result.command}\n${result.stderr}`);
  });

  test('reads, other hc commands, mentions and the escape pass', () => {
    const b = box();
    for (const command of ['hc ls', 'hc get jake-q', 'hc read --lines 0 t2', 'hc wait --children any', 'git commit -m "guard hc keys jake-q" -- a', 'grep -n hc docs/x.md', 'which hc', 'ls']) {
      assert.equal(b.hook(command).status, 0, command);
    }
    assert.equal(b.hook('SKIP_HC_GUARD=1 hc keys jake-q enter').status, 0);
    assert.deepEqual(b.calls(), [], 'the guard ran something other than a read');
  });
});
