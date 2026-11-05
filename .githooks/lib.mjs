// Shared by pre-commit (staged index) and pre-push (outgoing commits):
// read git blobs and refuse oversized files, credentials and broken
// shell / module syntax. Always the blob git will store, never the
// working-tree copy (another agent may be editing it).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
 * Other herdr agents live in this repo, via .claude/hooks/herdr-peers.sh
 * (prints nothing outside herdr). Advisory only; SKIP_HERDR_PEERS=1 hides it.
 * @returns {{ pane: string, status: string, goal: string, where: string }[]}
 */
export function herdrPeers(env = process.env) {
  const script = '.claude/hooks/herdr-peers.sh';
  if (env.SKIP_HERDR_PEERS === '1' || !existsSync(script)) return [];
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
