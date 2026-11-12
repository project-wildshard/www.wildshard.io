// DS11 (J221, J240): plan worktrees live at <repo>/.worktrees/<plan>, on plan/<plan>, inside the canonical checkout.
// Every tool that walks the canonical tree skips them, so a checkout with worktrees inside behaves like one without.
// Repo-kit ships this file byte-identical to every org repo; test/tooling/worktree-ignore.test.mjs is its guard.
//
// Who already skips them without this file: Git (`/.worktrees/` in .gitignore), so oxlint and oxfmt (they read
// .gitignore), `git status`/`git add` and so the staged-blob secrets and size checks. Vitest's include globs and the
// tsconfig includes are root-anchored. Who needs it: whole-root walkers (`shardfile-cache.mjs`), watchers (Vite and
// Vitest `server.watch.ignored`), path classifiers (`repo-size.mjs`) and the markdown hook's repo-relative paths.
//
// Every pattern is anchored at the repo root. A worktree is itself a checkout under `<canonical>/.worktrees/<plan>`, so
// an unanchored `**/.worktrees/**` would match every file of the worktree's own tree when matched as an absolute path,
// and its tools would ignore everything.
import { resolve } from 'node:path';

/** The folder, relative to the repo root. */
export const WORKTREES = '.worktrees';

/** A glob relative to the repo root, for globbers whose cwd is the root (Vitest `exclude`). */
export const WORKTREE_GLOB = `${WORKTREES}/**`;

/** True for the worktrees folder or anything inside it, given a repo-relative path with `/` separators. @param {string} path */
export function isWorktreePath(path) {
  return path === WORKTREES || path.startsWith(`${WORKTREES}/`);
}

/**
 * Watcher ignores (Vite and Vitest `server.watch.ignored`): chokidar matches absolute paths, so this is a RegExp over
 * the absolute worktrees folder of this root. Not a glob: chokidar turns `\\` into `/` before matching, so a glob could
 * not escape a checkout path holding `(`, `[` or `{`.
 * @param {string} [root] the repo root, default the working directory
 * @returns {RegExp[]}
 */
export function worktreeWatchIgnored(root = process.cwd()) {
  const folder = resolve(root, WORKTREES).replaceAll('\\', '/');
  return [new RegExp(`^${folder.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`)}(?:/|$)`, 'u')];
}
