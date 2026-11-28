import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';

const SHA = /^(?!0{40}$)[0-9a-f]{40}$/u;
const PROOF_PATH = /^tmp\/[^/]+\/land-gate-[a-z0-9]+\/proved\.json$/iu;
const LOCKFILE = /(?:^|[.-])lock(?:b|\.(?:json|ya?ml))?$|^npm-shrinkwrap\.json$/u;

/** @typedef {{ base: string, head: string }} Tip */

/** @param {string} path */
function changesInputs(path) {
  const name = basename(path);
  return name === 'package.json' || LOCKFILE.test(name) ||
    path === 'test/pins' || path.startsWith('test/pins/');
}

/** @param {string} root @param {Tip} proof @param {Tip} next */
function unchanged(root, proof, next) {
  if (!SHA.test(proof.base) || !SHA.test(proof.head) || proof.base === next.base) return false;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const options = { cwd: root, env, encoding: /** @type {const} */ ('utf8') };
  if (spawnSync('git', ['merge-base', '--is-ancestor', proof.base, next.base], options).status !== 0) return false;
  /** @param {string[]} args @returns {string[]} */
  const names = (args) => execFileSync('git', [...args, '-z', '--no-renames'], options).split('\0').filter(Boolean);
  /** @param {Tip} tip */
  const touched = (tip) => new Set(names(['log', '--format=', '--name-only', '--diff-merges=first-parent', `${tip.base}..${tip.head}`]));
  const lane = touched(proof);
  const replayed = touched(next);
  if (lane.size === 0 || lane.size !== replayed.size || [...lane].some((path) => !replayed.has(path))) return false;
  const upstream = names(['diff', '--name-only', proof.base, next.base]);
  if (upstream.some((path) => lane.has(path) || changesInputs(path))) return false;
  // A clean rebase can still change a generated file or drop part of a patch.
  return names(['diff', '--name-only', proof.head, next.head]).every((path) => !lane.has(path));
}

/** One land invocation owns the temporary proof. Git's ref line binds it to the attempted main update.
 * @param {string} root @param {NodeJS.ProcessEnv} [env] */
export function landGate(root, env = process.env) {
  const file = env.WS_LAND_GATE_FILE;
  if (file === undefined || !PROOF_PATH.test(relative(root, file).split(sep).join('/'))) return null;
  const rows = (env.WS_PUSH_REFS ?? '').trim().split('\n');
  if (rows.length !== 1) return null;
  const [, head = '', ref = '', base = ''] = (rows[0] ?? '').split(/\s+/u);
  if (ref !== 'refs/heads/main' || !SHA.test(base) || !SHA.test(head)) return null;
  const next = { base, head };
  return {
    reusable() {
      try {
        return unchanged(root, JSON.parse(readFileSync(file, 'utf8')), next);
      } catch {
        return false;
      }
    },
    record() {
      try {
        writeFileSync(file, JSON.stringify(next), { mode: 0o600 });
      } catch {
        // A missing proof just runs the next ordinary gate.
      }
    },
  };
}
