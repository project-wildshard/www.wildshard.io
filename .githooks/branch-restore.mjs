// Meta QA 11-25 row 113 (J381): a push that only re-creates deleted branches sends no new code, so the push lane
// (run-checks.mjs) skips it. Old branches predate later gates (engine's lean move), so the gate cannot pass on them,
// and SKIP_CHECK must be named in an outgoing commit, which a published commit cannot be edited to do.
//
// A ref line is a restore when it creates a remote branch other than main (git's remote sha is all zeros) at a sha
// that is an ancestor of the destination's advertised main, or at the sha ~/.cache/wildshard/deleted-branches.log
// (WS_BRANCH_LOG) recorded for this repo and this branch when land.mjs or meta's delete-landed-branches.sh deleted
// it. Every line of the push must be one. ALLOW_BRANCH_RESTORE=1 is the named hatch for a branch create the log
// missed: it skips the push lane for creates of non-main branches, and check-push.mjs does not ask an outgoing
// commit to name it. A push to refs/heads/main never takes either path. check-push's blob checks still run.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { advertisedTips } from './lib.mjs';

const ZERO = /^0+$/u;
const SHA = /^[0-9a-f]{40}$/u;
const HEAD = 'refs/heads/';

/** git's pre-push ref lines: `<local ref> <local sha> <remote ref> <remote sha>`.
 * @param {string} text */
export function refLines(text) {
  return text.split('\n').map((line) => line.trim().split(/\s+/u)).filter((row) => row[0] !== '')
    .map(([localRef = '', local = '', remoteRef = '', remote = '']) => ({ localRef, local, remoteRef, remote }));
}

/** A line that creates a remote branch other than main: never an update, a delete, a tag or main.
 * @param {{ local: string, remoteRef: string, remote: string }} line */
export const branchCreate = ({ local, remoteRef, remote }) =>
  SHA.test(local) && !ZERO.test(local) && ZERO.test(remote) && remoteRef.startsWith(HEAD) && remoteRef !== `${HEAD}main`;

/** Names this repo goes by in the deleted-branches log: the canonical checkout's folder and the destination's name.
 * @param {string} root @param {string} destination */
export function repoNames(root, destination) {
  const names = new Set();
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  if (common.status === 0 && common.stdout.trim()) names.add(basename(dirname(common.stdout.trim())));
  const url = destination || spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || '';
  const name = basename(url.replace(/\/+$/u, '')).replace(/\.git$/u, '');
  if (name) names.add(name);
  return names;
}

/** The shas the log recorded for `branch` in any of `names`: `<time> <repo> <local|remote> <branch> <sha>` lines.
 * @param {string} log @param {Set<string>} names @param {string} branch */
export function loggedShas(log, names, branch) {
  if (!existsSync(log)) return [];
  let text = '';
  try {
    text = readFileSync(log, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').map((line) => line.trim().split(/\s+/u))
    .filter(([, repo = '', , name = '', sha = '']) => names.has(repo) && name === branch && /^[0-9a-f]{7,40}$/u.test(sha))
    .map(([, , , , sha = '']) => sha);
}

/** Whether this push only restores deleted branches, and why; anything unreadable keeps the gate.
 * @param {string} root @param {string} refs the hook's ref lines @param {NodeJS.ProcessEnv} [env] */
export function restoreVerdict(root, refs, env = process.env) {
  const lines = refLines(refs);
  if (!lines.length || !lines.every(branchCreate)) return { ok: false, reason: '' };
  const names = lines.map(({ remoteRef }) => remoteRef.slice(HEAD.length));
  if (env.ALLOW_BRANCH_RESTORE === '1') return { ok: true, reason: `ALLOW_BRANCH_RESTORE=1 (J381): branch create of ${names.join(', ')}` };
  const destination = env.WS_PUSH_DESTINATION ?? '';
  const log = env.WS_BRANCH_LOG || join(homedir(), '.cache/wildshard/deleted-branches.log');
  const repos = repoNames(root, destination);
  /** @type {string[] | null} */
  let tips = null;
  const why = [];
  for (const [at, { local }] of lines.entries()) {
    const branch = names[at] ?? '';
    const label = `${branch} at ${local.slice(0, 12)}`;
    if (loggedShas(log, repos, branch).some((sha) => local.startsWith(sha))) {
      why.push(`${label} (deleted-branches.log)`);
      continue;
    }
    tips ??= advertisedTips(destination);
    if (tips.some((tip) => spawnSync('git', ['merge-base', '--is-ancestor', local, tip], { cwd: root }).status === 0)) {
      why.push(`${label} (on the destination's main)`);
      continue;
    }
    return { ok: false, reason: `${label} is new work` };
  }
  return { ok: true, reason: `branch restore of ${why.join(', ')}: no new commit` };
}
