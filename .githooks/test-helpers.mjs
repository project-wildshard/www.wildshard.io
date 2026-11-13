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
const SCRIPTS = join(HOOKS, '..', 'kit', 'scripts');
export const TRAILER = 'Assisted-by: Claude Code:claude-opus-5-5';
export const ok = (subject, body = 'Why this matters.') => `${subject}\n\n${body}\n\n${TRAILER}\n`;

export const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Drop GIT_* (a hook running this suite exports its own GIT_INDEX_FILE)
// and every bypass flag, then isolate from the user's git config.
const BYPASS = new Set(['SKIP_ATTRIB', 'SKIP_JOURNAL', 'SKIP_CHECK', 'SKIP_BUDGET', 'ALLOW_BRANCH', 'ALLOW_BIG', 'ALLOW_SECRET', 'PRECOMMIT_SOFT_S', 'PRECOMMIT_HARD_S', 'HERDR_ENV', 'HERDR_PANE_ID', 'CLAUDE_CODE_SESSION_ID', 'SKIP_HERDR_PEERS']);
export const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !BYPASS.has(key))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

export function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'repo-hooks-'));
  roots.push(root);
  const git = (args, env = {}) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...ENV, ...env } });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  cpSync(HOOKS, join(root, '.githooks'), { recursive: true });
  if (existsSync(SCRIPTS)) cpSync(SCRIPTS, join(root, 'kit', 'scripts'), { recursive: true }); // ask tooling
  git(['config', 'core.hooksPath', '.githooks']);
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  /** Stage files (plus a journal entry unless journal: false) and commit. */
  const commit = (files, message, { journal = true, env = {} } = {}) => {
    const all = { ...files };
    if (journal) all['project/journal/2026-11-04.md'] = `- ${Object.keys(files).join(', ') || 'update'}\n`;
    for (const [path, content] of Object.entries(all)) write(path, content);
    git(['add', '--', ...Object.keys(all)]);
    return git(['commit', '-q', '-m', message], env);
  };
  return { root, git, write, commit };
}
