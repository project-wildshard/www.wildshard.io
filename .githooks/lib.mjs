// Shared by pre-commit (staged index) and pre-push (outgoing commits):
// read git blobs and refuse oversized files, credentials and broken
// shell / module syntax. Always the blob git will store, never the
// working-tree copy (another agent may be editing it).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_BYTES = 1024 * 1024;

const SECRETS = [
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/],
  ['GitHub token', /\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ['Socket API token', /\bsktsec_[A-Za-z0-9_]{20,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['quoted credential', /(?:api[_-]?key|secret|token|passw(?:or)?d)["']?\s*[:=]\s*["'][A-Za-z0-9/+_.=-]{20,}["']/i],
];

export const git = (args, options = {}) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });

// A new target ref proves nothing about which objects that remote has. Other remotes must not exempt its history.
// Local tracking refs can be stale. What the destination itself advertises right
// now can exempt history (J240: a first plan/<slug> push sends only the plan's
// commits): pass the tips `git ls-remote <push URL>` returned, present locally.
export const outgoingRange = (local, remote, advertised = []) => remote && !/^0+$/u.test(remote) ? [`${remote}..${local}`]
  : advertised.length ? [local, '--not', ...advertised] : [local];

/** Heads the push destination advertises that this repo has, or [] on any doubt.
 * @param {string} url the hook's actual push URL ($2) */
export function advertisedTips(url) {
  if (!url) return [];
  try {
    const out = execFileSync('git', ['ls-remote', '--heads', '--', url, 'refs/heads/main'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n').map((row) => row.split('\t')[0] ?? '').filter((sha) => /^[0-9a-f]{40}$/u.test(sha))
      .filter((sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0);
  } catch {
    return [];
  }
}

/** The plan slug of a linked worktree at `<main worktree>/.worktrees/<slug>`, else null.
 * The main worktree is Git's own first `worktree list` entry, and it must be a
 * non-bare checkout whose Git dir is this common dir: a separate Git dir never
 * makes its parent folder a canonical checkout.
 * @param {string} top the worktree's top level @param {string} common its absolute common Git dir */
export function planWorktreeSlug(top, common) {
  try {
    const first = git(['worktree', 'list', '--porcelain']).split('\n\n')[0] ?? '';
    const canonical = /^worktree (.+)$/mu.exec(first)?.[1];
    if (!canonical || /^bare$/mu.test(first)) return null;
    // A hook exports GIT_DIR/GIT_INDEX_FILE for its own worktree; ask the main one cleanly.
    const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const own = git(['-C', canonical, 'rev-parse', '--path-format=absolute', '--absolute-git-dir'], { env: clean }).trim();
    if (realpathSync(own) !== realpathSync(common)) return null;
    const prefix = `${realpathSync(canonical)}/.worktrees/`, real = realpathSync(top);
    const match = /^([a-z0-9][a-z0-9._-]*)$/u.exec(real.startsWith(prefix) ? real.slice(prefix.length) : '');
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The branch a rebase in progress will update (refs/heads/...), or null.
 * @param {string} dir a rebase-merge or rebase-apply directory */
export function rebaseHeadName(dir) {
  try {
    return readFileSync(join(dir, 'head-name'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Sizes for many blob ids in one `git cat-file` call. */
export function blobSizes(objects) {
  const unique = [...new Set(objects)];
  if (!unique.length) return new Map();
  const out = git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], { input: unique.join('\n') + '\n' });
  return new Map(out.trim().split('\n').map((row) => {
    const [object, bytes] = row.split(' ');
    return [object, Number(bytes)];
  }));
}

const readBlob = (object, size) => execFileSync('git', ['cat-file', 'blob', object], { maxBuffer: size + 1024 });

const isShell = (path) => path.endsWith('.sh') || /^\.githooks\/[^/.]+$/.test(path);

/**
 * Check one blob. `entry` is { path, object, mode }.
 * @returns {string[]} problems; empty when clean.
 */
export function checkBlob(entry, size, env = process.env) {
  const { path, object, mode } = entry;
  if (mode === '160000' || mode === '120000') return []; // submodule / symlink
  const problems = [];
  if (size > MAX_BYTES && env.ALLOW_BIG !== '1') {
    problems.push(`${path}: ${(size / 1024 / 1024).toFixed(1)} MB is over the 1 MB cap (ALLOW_BIG=1 to override)`);
    return problems;
  }
  const bytes = readBlob(object, size);
  if (bytes.subarray(0, 8000).includes(0)) return problems; // binary

  const text = bytes.toString('utf8');
  if (env.ALLOW_SECRET !== '1') {
    for (const [name, pattern] of SECRETS) {
      const lines = text.split('\n');
      const at = lines.findIndex((line) => pattern.test(line));
      if (at !== -1) {
        problems.push(`${path}:${at + 1}: looks like a ${name}. Reference where it lives, never the value (ALLOW_SECRET=1 for a false positive)`);
        break;
      }
    }
  }

  let check;
  if (isShell(path)) check = spawnSync('bash', ['-n'], { input: bytes, encoding: 'utf8' });
  else if (path.endsWith('.mjs')) check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: bytes, encoding: 'utf8' });
  if (check && check.status !== 0) problems.push(`${path}: syntax error\n${check.stderr.trim()}`);
  return problems;
}

export function report(title, problems) {
  if (!problems.length) return false;
  console.error(`\n  X ${title}:\n`);
  for (const problem of problems) console.error('    ' + problem.replace(/\n/g, '\n      '));
  console.error('');
  return true;
}

/**
 * Other herdr agents live in this repo, via herdr-peers.sh in .agents/hooks/
 * (.claude/hooks/ before the agent layout; prints nothing outside herdr).
 * Advisory only; SKIP_HERDR_PEERS=1 hides it.
 * @returns {{ pane: string, status: string, goal: string, where: string }[]}
 */
export function herdrPeers(env = process.env) {
  const script = ['.agents/hooks/herdr-peers.sh', '.claude/hooks/herdr-peers.sh'].find((path) => existsSync(path));
  if (env.SKIP_HERDR_PEERS === '1' || !script) return [];
  const out = spawnSync('bash', [script], { encoding: 'utf8', timeout: 5000 }).stdout ?? '';
  return out.split('\n').filter(Boolean).map((line) => {
    const [pane = '?', status = '?', goal = '-', where = 'main'] = line.split('\t');
    return { pane, status, goal: goal === '-' ? '(no goal set)' : goal, where };
  });
}

export function printPeers(peers, headline) {
  if (!peers.length) return;
  console.error(`  - herdr: ${peers.length} other agent(s) ${headline}`);
  for (const peer of peers) console.error(`      ${peer.pane} (${peer.status}) — ${peer.goal} [${peer.where}]`);
}
