#!/usr/bin/env node
// PreToolUse(Bash) guard, for Claude Code and Codex alike (meta QA-FEEDBACK-2026-11-24 row 41). Jake, 2026-11-24 ~14:00
// Cancún, after a release lane opened repo-kit PR #6: "lets not open PRs in project wildshard i dont think its needed".
// Work reaches main by push (J422: land.mjs, main-push.mjs), never by a pull request. This refuses, for a
// project-wildshard/* repo:
//   - `gh pr create` (and its alias `gh pr new`);
//   - `gh api` POSTs to `repos/<owner>/<repo>/pulls` (explicit -X/--method POST, or implied by -f/-F/--input);
//   - `gh api graphql` with a `createPullRequest` mutation.
// The repo is the command's -R/--repo, then GH_REPO=, then the api path's owner, then the origin remote of the folder the
// command runs in (the payload's cwd, then the last `cd <dir>` before it). Anything outside project-wildshard passes.
// Escape hatch (J381): ALLOW_WILDSHARD_PR=1 in the command. Bad input prints nothing and exits 0: a hook must never
// break a session.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPayload } from './lib/payload.mjs';

export const ORG = 'project-wildshard';
const OWNED = new RegExp(`(?:^|[/:\\s])${ORG}/[A-Za-z0-9._-]+`, 'iu');

/** `gh` as the command word: after env assignments or a wrapper, or inside $( ), ( ) or backticks. */
const GH_WORD = '(?:^\\s*(?:\\w+=\\S*\\s+)*(?:(?:timeout\\s+\\S+|nohup|exec|command|time|env)\\s+)*(?:\\w+=\\S*\\s+)*|[(`]\\s*)gh\\s+';
const PR_CREATE = new RegExp(`${GH_WORD}(?:(?:-R|--repo)(?:\\s+|=)\\S+\\s+)?pr\\s+(?:create|new)\\b`, 'u');
const API = new RegExp(`${GH_WORD}(?:(?:-R|--repo)(?:\\s+|=)\\S+\\s+)?api\\s`, 'u');
const PULLS_PATH = /(?:^|\s)\/?repos\/([^/\s]+)\/([^/\s]+)\/pulls\/?(?:\?\S*)?(?=\s|$)/u;

/**
 * Replace quoted strings with placeholders, so a message's `;` or `gh pr create` reads as text, not a command.
 * @param {string} command @returns {{ bare: string, quoted: string[] }}
 */
function unquote(command) {
  /** @type {string[]} */
  const quoted = [];
  const bare = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/gu, (match) => {
    quoted.push(match.slice(1, -1));
    return `__Q${quoted.length - 1}__`;
  });
  return { bare, quoted };
}

/** @param {string} text @param {string[]} quoted */
const requote = (text, quoted) => text.replace(/__Q(\d+)__/gu, (_, index) => quoted[Number(index)] ?? '');

/** The value of -R/--repo or GH_REPO= in a segment, or ''. @param {string} segment */
function repoFlag(segment) {
  const flag = /(?:^|\s)(?:-R|--repo)(?:\s+|=)(\S+)/u.exec(segment);
  if (flag) return flag[1];
  const env = /(?:^|\s)GH_REPO=(\S+)/u.exec(segment);
  return env ? env[1] : '';
}

/** A folder from `cd` text: ~ and relative paths resolve against `from`. @param {string} from @param {string} to */
const at = (from, to) => (to.startsWith('~') ? `${homedir()}${to.slice(1)}` : isAbsolute(to) ? to : resolve(from, to));

/** The origin remote of a folder, or '' when it has none. @param {string} dir */
function origin(dir) {
  const result = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5000 });
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * Why a shell command opens a pull request on a project-wildshard repo, or null when it does not.
 * @param {string} command @param {{ cwd?: string, remoteOf?: (dir: string) => string }} [where]
 * @returns {string | null}
 */
export function opensPr(command, where = {}) {
  if (/(?:^|\s)ALLOW_WILDSHARD_PR=1(?:\s|$)/u.test(command)) return null;
  const remoteOf = where.remoteOf ?? origin;
  const { bare, quoted } = unquote(command);
  let dir = where.cwd || process.cwd();
  for (const raw of bare.split(/&&|\|\||[;&|\n]/u)) {
    const segment = requote(raw, quoted).trim();
    const cd = /^cd\s+(\S+)/u.exec(segment);
    if (cd) {
      dir = at(dir, cd[1]);
      continue;
    }
    // Command words are read with quotes still out, so `echo "gh pr create"` is text.
    const word = raw.trim();
    /** @type {string | null} */
    let what = null;
    let owner = repoFlag(segment);
    if (PR_CREATE.test(word)) what = '`gh pr create`';
    else if (API.test(word)) {
      const graphql = /\sapi\s+graphql\b/u.test(word) && /createPullRequest/u.test(segment);
      const path = PULLS_PATH.exec(segment);
      const post = /(?:^|\s)(?:-X\s*|--method(?:\s+|=))POST\b/iu.test(segment)
        || (!/(?:^|\s)(?:-X\s*|--method(?:\s+|=))(?:GET|HEAD)\b/iu.test(segment) && /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?:\s|=)/u.test(segment));
      if (graphql) what = 'a `createPullRequest` mutation';
      else if (path && post) {
        what = `a \`gh api\` POST to ${path[0].trim()}`;
        if (!/^[{:]/u.test(path[1])) owner ||= `${path[1]}/${path[2]}`;
      }
      if (graphql && !owner && OWNED.test(segment)) owner = `${ORG}/`;
    }
    if (what === null) continue;
    const target = owner || remoteOf(dir);
    if (OWNED.test(` ${target}`)) return `${what} on ${target.replace(/^.*github\.com[:/]/u, '').replace(/\.git$/u, '')}`;
  }
  return null;
}

/** The refusal text: what happened, the way through, and the escape hatch. @param {string} reason */
export function refusal(reason) {
  return [
    `BLOCKED by .agents/hooks/no-pr-guard.mjs: ${reason}.`,
    '',
    'No pull requests in project-wildshard (Jake, 2026-11-24: "lets not open PRs in project wildshard i dont think',
    'its needed"). Work reaches main by push: in engine `node scripts/land.mjs` from a plan worktree, or',
    '`node scripts/main-push.mjs` for a fix; in other org repos commit on main and push with main-push.mjs.',
    'Escape hatch, only on Jake\'s word: put ALLOW_WILDSHARD_PR=1 in front of the command.',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  let reason = null;
  try {
    const { tool, command, cwd } = readPayload(raw);
    reason = tool === 'shell' ? opensPr(command, { cwd }) : null;
  } catch {
    reason = null;
  }
  if (reason !== null) {
    process.stderr.write(`${refusal(reason)}\n`);
    process.exit(2);
  }
}
