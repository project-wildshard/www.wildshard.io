// The push lane checks the pushed commit in a clean copy of it, never the shared working tree (meta MINI-DECISIONS
// M1; engine's scripts/push-gate-copy.mjs, BUILD-MAX EV1, for the kit's repos). Many lanes commit by pathspec in one
// checkout on main: a gate run there would type-check, lint and test whatever bytes the other lanes have written, and
// refuse or pass on files the push does not carry.
//
// The copy is a detached `git worktree` of the pushed SHA under <root>/tmp/push-gate/<sha>-<pid>:
//   1. git checks out the pushed tree, so other lanes' edits and untracked files never enter;
//   2. `pnpm install --frozen-lockfile --prefer-offline` links the pushed lockfile's packages from the store (about 4 s
//      with pnpm's global virtual store; it fetches only what the store lacks; the checkout's node_modules links are
//      relative, so a clone of them would not resolve one level deeper);
//   3. the checkout's .bin-deps/node_modules (npr's shared tools), when present, is cloned copy-on-write;
//   4. the gate runs there; then the copy is renamed aside, unregistered and deleted, green or red. A copy whose gate
//      was killed is swept by the next one (its pid is gone).
// It copies in the canonical checkout always (other lanes may write while the gate runs), and in a linked worktree
// only when that worktree is dirty or not at the pushed tree. CI never copies. WS_PUSH_GATE_COPY=0 gates in place.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Where copies live, under the checkout (gitignored tmp/; AGENTS.md: never the system tmp). */
export const GATE_DIR = 'tmp/push-gate';

/** The environment without the hook's GIT_* variables: a GIT_DIR from the pushing checkout must never steer the copy.
 * @param {NodeJS.ProcessEnv} [env] */
export function cleanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 << 20 }).trim();
}

/** The one commit a push publishes, or null for a delete-only push. Refs with different trees gate in place: one
 * gate proves one tree. @param {string} root @param {string|undefined} refs @returns {string|null} */
export function pushedCommit(root, refs) {
  /** @type {string|null} */ let sha = null;
  /** @type {string|null} */ let tree = null;
  for (const line of (refs ?? '').split('\n').map((row) => row.trim()).filter(Boolean)) {
    const local = line.split(/\s+/u)[1] ?? '';
    if (!/^[a-f0-9]{40}$/u.test(local)) return null;
    if (/^0+$/u.test(local)) continue;
    const own = git(root, ['rev-parse', '--verify', `${local}^{tree}`]);
    if (tree !== null && own !== tree) return null;
    sha ??= local;
    tree = own;
  }
  return sha;
}

/** Why this push gates in a clean copy, or null to gate in place.
 * @param {string} root @param {string|null} sha @param {NodeJS.ProcessEnv} [env] */
export function copyReason(root, sha, env = process.env) {
  if (sha === null || env.CI || env.GITHUB_ACTIONS || env.WS_PUSH_GATE_COPY === '0') return null;
  const gitDir = resolve(root, git(root, ['rev-parse', '--git-dir']));
  const common = resolve(root, git(root, ['rev-parse', '--git-common-dir']));
  if (gitDir === common) return 'canonical checkout (shared by lanes on main, M1)';
  if (git(root, ['rev-parse', 'HEAD^{tree}']) !== git(root, ['rev-parse', `${sha}^{tree}`])) return 'pushed commit is not the checked-out tree';
  const dirt = git(root, ['status', '--porcelain', '--untracked-files=normal']).split('\n').filter(Boolean);
  return dirt.length === 0 ? null : `${dirt.length} uncommitted path(s) in the checkout, e.g. ${dirt[0].slice(3)}`;
}

/** Remove copies a killed gate left behind: their pid (the name's suffix) is gone. A live gate's copy is never touched.
 * @param {string} root @returns {number} removed */
export function sweepDeadCopies(root) {
  let removed = 0;
  /** @type {string[]} */ let names = [];
  try {
    names = readdirSync(join(root, GATE_DIR));
  } catch {
    return 0;
  }
  for (const name of names) {
    const pid = Number(/-(\d+)(?:\.trash)?$/u.exec(name)?.[1] ?? '0');
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try {
      process.kill(pid, 0);
      continue;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') continue;
    }
    const path = join(root, GATE_DIR, name);
    try {
      git(root, ['worktree', 'remove', '--force', path]);
    } catch {
      /* Not registered. */
    }
    rmSync(path, { recursive: true, force: true });
    removed++;
  }
  if (removed > 0) {
    try {
      git(root, ['worktree', 'prune']);
    } catch {
      /* Housekeeping only. */
    }
  }
  return removed;
}

/** Make the clean copy of `sha`. Returns its path and a remover; on failure removes what it made and throws.
 * @param {string} root the pushing checkout @param {string} sha
 * @param {{say?:(line:string)=>void,env?:NodeJS.ProcessEnv}} [options] */
export function makeGateCopy(root, sha, { say = (line) => process.stderr.write(`${line}\n`), env = process.env } = {}) {
  const path = join(root, GATE_DIR, `${sha.slice(0, 12)}-${process.pid}`);
  const began = performance.now();
  /** @type {string[]} */ const steps = [];
  /** @param {string} step @param {() => void} work */
  const timed = (step, work) => {
    const at = performance.now();
    work();
    steps.push(`${step} ${((performance.now() - at) / 1000).toFixed(1)} s`);
  };
  // Removal is off the push's path: the copy is renamed aside, unregistered, and deleted by a detached rm.
  const remove = () => {
    const trash = `${path}.trash`;
    try {
      renameSync(path, trash);
      spawn('rm', ['-rf', trash], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      rmSync(path, { recursive: true, force: true });
    }
    try {
      git(root, ['worktree', 'prune']);
    } catch {
      /* Prune is housekeeping only. */
    }
  };
  mkdirSync(dirname(path), { recursive: true });
  sweepDeadCopies(root);
  // A leftover registration of this very path (a reused pid) would make `worktree add` refuse: clear both.
  remove();
  try {
    timed('checkout', () => git(root, ['worktree', 'add', '--quiet', '--detach', path, sha]));
    if (existsSync(join(path, 'pnpm-lock.yaml'))) {
      timed('install', () => {
        const child = spawnSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: path, env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 << 20 });
        const said = `${child.stdout ?? ''}\n${child.stderr ?? ''}`.trim().split('\n').filter((line) => /ERR|error|Error/u.test(line)).slice(-3).join(' | ');
        if (child.status !== 0) throw new Error(`pnpm install --frozen-lockfile --prefer-offline in the gate copy exited ${String(child.status)}: ${said || 'no error line; rerun it in the copy to see why'}`);
      });
    }
    // The shared binary tools (.bin-deps, npr): a copy-on-write clone of the checkout's install, so the gate's frozen
    // `npr install` finds them in place; npr refuses a stale one against the pushed lock.
    const tools = join(root, '.bin-deps/node_modules');
    if (existsSync(tools) && existsSync(join(path, '.bin-deps')) && !existsSync(join(path, '.bin-deps/node_modules'))) {
      timed('tools', () => {
        const child = spawnSync('cp', process.platform === 'darwin' ? ['-cR', tools, join(path, '.bin-deps/')] : ['-R', tools, join(path, '.bin-deps/')], { stdio: 'ignore' });
        if (child.status !== 0) rmSync(join(path, '.bin-deps/node_modules'), { recursive: true, force: true });
      });
    }
    const dirt = git(path, ['status', '--porcelain', '--untracked-files=normal']).split('\n').filter(Boolean);
    if (dirt.length > 0) throw new Error(`the gate copy of ${sha.slice(0, 10)} is not clean:\n${dirt.slice(0, 10).join('\n')}`);
  } catch (error) {
    remove();
    throw error;
  }
  say(`  - push-gate copy (M1): ${sha.slice(0, 10)} at ${GATE_DIR}/${path.split('/').at(-1)} in ${((performance.now() - began) / 1000).toFixed(1)} s; ${steps.join(', ')}`);
  return { path, remove };
}
