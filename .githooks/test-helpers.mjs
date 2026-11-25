// Shared by the hook tests (run: node --test .githooks/*.test.mjs).
// sandbox() copies .githooks/ into a throwaway repo so each case drives
// real `git commit` / `git push` through the installed hooks.
import { after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HOOKS, '..', 'src', 'scripts', '.kit');
export const TRAILER = 'Assisted-by: Claude:claude-opus-5-5';
export const ok = (subject, body = 'Why this matters.') => `${subject}\n\n${body}\n\n${TRAILER}\n`;

export const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Drop GIT_* (a hook running this suite exports its own GIT_INDEX_FILE),
// pre-push's WS_PUSH_REFS (the outer push's refs, unknown to a sandbox),
// hc's terminal identity (a sandbox is not the agent's terminal) and every
// bypass flag, then isolate from the user's git config.
const BYPASS = new Set(['WS_PUSH_REFS', 'SKIP_ATTRIB', 'SKIP_JOURNAL', 'SKIP_CHECK', 'SKIP_BUDGET', 'ALLOW_BRANCH', 'ALLOW_BIG', 'ALLOW_SECRET', 'PRECOMMIT_SOFT_S', 'PRECOMMIT_HARD_S', 'HC_TERMINAL_ID', 'HC_TERMINAL_SOCKET', 'HC_SCOPE', 'HC_SESSION', 'HC_SOCKET', 'CLAUDE_CODE_SESSION_ID', 'SKIP_PEERS', 'KIT_STAMP', 'ALLOW_KIT_EDIT']);
export const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !BYPASS.has(key) && !/^(?:SKIP|ALLOW)_/u.test(key))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

/** `message` with a body paragraph naming each SKIP_ or ALLOW_ variable `env` sets, with a reason, before its trailers
 * (commit-msg's J381 rule). @param {string} message @param {Record<string, string>} env */
export function nameHatches(message, env = {}) {
  const set = Object.entries(env).filter(([name, value]) => /^(?:SKIP|ALLOW)_/u.test(name) && name !== 'SKIP_PEERS' && value !== '' && value !== '0').map(([name]) => name);
  if (!set.length) return message;
  const line = `${set.map((name) => `${name}=1`).join(' and ')}: this test sets it on purpose to prove the bypass.`;
  const lines = message.replace(/\n+$/u, '').split('\n');
  const trailer = lines.findIndex((text, at) => at > 0 && /^Assisted-by: /u.test(text) && lines[at - 1] === '');
  if (trailer < 0) return `${lines.join('\n')}\n\n${line}\n`;
  return `${[...lines.slice(0, trailer), line, '', ...lines.slice(trailer)].join('\n')}\n`;
}

export function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'repo-hooks-'));
  roots.push(root);
  const git = (args, env = {}) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...ENV, ...env } });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  cpSync(HOOKS, join(root, '.githooks'), { recursive: true });
  if (existsSync(SCRIPTS)) cpSync(SCRIPTS, join(root, 'src', 'scripts', '.kit'), { recursive: true }); // ask tooling
  git(['config', 'core.hooksPath', '.githooks']);
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  /** Stage files (plus a journal entry unless journal: false) and commit. A SKIP_ or ALLOW_ variable in `env` is named
   * in the body, as commit-msg asks (J381), unless named: false. */
  const commit = (files, message, { journal = true, env = {}, named = true } = {}) => {
    const all = { ...files };
    if (journal) all['project/journal/2026-11-04.md'] = `- ${Object.keys(files).join(', ') || 'update'}\n`;
    for (const [path, content] of Object.entries(all)) write(path, content);
    git(['add', '--', ...Object.keys(all)]);
    return git(['commit', '-q', '-m', named ? nameHatches(message, env) : message], env);
  };
  return { root, git, write, commit };
}
