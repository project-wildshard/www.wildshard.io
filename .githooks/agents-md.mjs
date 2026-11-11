// AGENTS.md shape and edit rule (J241; docs/agents-md.md).
//
// Every repo's AGENTS.md has Jake's section on top, one marker line,
// then the agent-written section, which opens with `## Agent-written`.
// Agents (Claude, Codex) edit only below the marker.
//
//   lint            the working tree: AGENTS.md exists and has the
//                   shape; CLAUDE.md, if present, is `@AGENTS.md`.
//   commit <msg>    commit-msg: lint the staged files, then refuse an
//                   AI commit (Assisted-by trailer) that changes a line
//                   above the marker.
//   push            pre-push (ref lines on stdin): the same rule for
//                   every outgoing commit, merges included, and the
//                   shape at each pushed tip.
//
// A commit with no AI trailer (Jake's, SKIP_ATTRIB=1) may change
// anything. An AI commit may add the marker to a file that had none,
// with only a stub above it: the first conversion.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

export const MARKER = '<!-- agents-below: everything under this line is agent-written (Claude, Codex); agents never edit above it (J241) -->';
export const HEADING = '## Agent-written';
export const TITLE = '# AGENTS.md';
export const STUB_LINES = 3;
const STUB_WIDTH = 200;
// "Written by: Claude" in any Markdown dress: quote, list item, bold or italic.
const ATTRIBUTED = /^\s*(?:(?:>|[-*+]|\d+[.)])\s*)*(?:\*\*|__|\*|_)?Written by\b.*\b(?:Claude|Codex)\b/i;
const NOT_STUB = /^\s*(?:#+\s|[-*+]\s|\d+[.)]\s|\||```|~~~)/;
const HOW = 'Put it below the marker; Jake promotes it.';

// Lines keep a CRLF's \r, so changing the line endings of Jake's section is a change; the lint reads past it.
const lines = (text) => text.split('\n');
const bare = (line) => line.replace(/\r$/, '');
const markerAt = (all) => all.reduce((at, line, i) => (bare(line) === MARKER ? [...at, i] : at), []);
const quote = (line) => JSON.stringify(line.length > 70 ? `${line.slice(0, 70)}…` : line);

/** @returns {string[]} plain-language problems with AGENTS.md; `null` text means the file is missing. */
export function lintAgents(text) {
  if (text === null) {
    return ['AGENTS.md is missing. Every repo keeps one (J241): Jake\'s section on top, the marker line, then "## Agent-written".'];
  }
  const all = lines(text);
  const at = markerAt(all);
  if (at.length === 0) {
    const near = all.findIndex((line) => line.includes('agents-below'));
    return [near === -1
      ? `AGENTS.md has no marker line. Put this line, exactly, between Jake's section and the agent section:\n${MARKER}`
      : `AGENTS.md line ${near + 1} looks like the marker but is not exact. Restore it, character for character:\n${MARKER}`];
  }
  if (at.length > 1) {
    return [`AGENTS.md has the marker line ${at.length} times (lines ${at.map((i) => i + 1).join(', ')}). Keep exactly one.`];
  }
  const problems = [];
  const next = all.findIndex((line, i) => i > at[0] && line.trim() !== '');
  if (next === -1 || bare(all[next]) !== HEADING) {
    problems.push(next === -1
      ? `AGENTS.md ends at the marker. The agent section must follow it, opening with "${HEADING}".`
      : `AGENTS.md line ${next + 1} is the first line after the marker; it must be "${HEADING}", not ${quote(all[next])}.`);
  }
  for (let i = 0; i < at[0]; i++) {
    if (ATTRIBUTED.test(all[i])) {
      problems.push(`AGENTS.md line ${i + 1} is above the marker but agent-attributed (${quote(all[i])}). Jake's section holds only his words. ${HOW}`);
    }
  }
  return problems;
}

/** @returns {string[]} problems with CLAUDE.md; `null` text (no file) passes. */
export function lintClaude(text) {
  if (text === null || text === '@AGENTS.md' || text === '@AGENTS.md\n') return [];
  return ['CLAUDE.md must be exactly one line, "@AGENTS.md". Guidance goes in AGENTS.md (below the marker, for an agent).'];
}

/** True when a commit message carries an AI trailer (comments and the `commit -v` diff excluded). */
export function isAiMessage(raw) {
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (/^# -+ >8 -+$/.test(line)) break;
    if (!line.startsWith('#') && /^assisted-by:/i.test(line.trim())) return true;
  }
  return false;
}

/**
 * The edit rule for one change to AGENTS.md. `before` / `after` are the
 * file's text (or `null` when absent); `ai` is whether the commit has an
 * AI trailer.
 * @returns {string[]} why the change is refused; empty when allowed.
 */
export function guard(before, after, { ai }) {
  if (!ai || before === after) return [];
  const old = before === null ? [] : lines(before);
  const oldAt = markerAt(old);
  if (after === null) {
    return oldAt.length ? ['This AI commit deletes AGENTS.md, Jake\'s section included. Restore it; edit only below the marker.'] : [];
  }
  const now = lines(after);
  const nowAt = markerAt(now);
  if (!oldAt.length && !nowAt.length) return []; // a file from before J241: the lint covers its shape
  if (!nowAt.length) return [`This AI commit removes the marker line from AGENTS.md. Keep it, exactly:\n${MARKER}`];
  const above = now.slice(0, nowAt[0]);

  if (!oldAt.length) {
    // The first conversion: the marker is new, and above it may sit only the title and a stub for Jake to fill.
    const body = above.map((line, i) => [i, bare(line)]).filter(([, line]) => line.trim() !== '');
    if (body.length && body[0][1] === TITLE) body.shift();
    const bad = body.filter(([, line]) => NOT_STUB.test(line) || ATTRIBUTED.test(line) || line.length > STUB_WIDTH);
    if (body.length <= STUB_LINES && !bad.length) return [];
    const [i, line] = bad[0] ?? body[STUB_LINES];
    return [
      'This AI commit adds the marker to AGENTS.md but puts content above it.',
      `Converting a file, an agent may put only the "${TITLE}" title and at most ${STUB_LINES} short stub lines above the marker (no headings, lists, tables, code or "Written by: Claude/Codex").`,
      `First line that does not fit: line ${i + 1}, ${quote(line)}. ${HOW}`,
    ];
  }

  const was = old.slice(0, oldAt[0]);
  if (was.length === above.length && was.every((line, i) => line === above[i])) return [];
  let i = 0;
  while (i < was.length && i < above.length && was[i] === above[i]) i++;
  const where = i < above.length ? `line ${i + 1} now reads ${quote(above[i])}` : `line ${i + 1} was ${quote(was[i])}`;
  return [
    'This AI commit changes Jake\'s section of AGENTS.md, above the J241 marker. Agents never edit above it.',
    `First change: ${where}.`,
    `${HOW} Unstage the change above the marker and commit again.`,
    'Jake edits his own section in a human commit (no Assisted-by trailer, SKIP_ATTRIB=1); agents never take that path.',
  ];
}

/**
 * The rule for a commit with any number of parents. A merge's section
 * above the marker must be exactly one a marked parent already had, so
 * resolving a conflict cannot write new text there; only when no
 * parent has the marker does the first-conversion rule apply.
 */
export function guardMerge(parents, after, { ai }) {
  const marked = parents.filter((before) => before !== null && markerAt(lines(before)).length);
  if (!marked.length) return guard(parents[0] ?? null, after, { ai });
  const results = marked.map((before) => guard(before, after, { ai }));
  return results.some((refused) => !refused.length) ? [] : results[0];
}

const run = (args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
/** A blob's text at `<rev>:<path>` (`:path` is the index), or null when absent. */
export function show(spec) {
  const result = run(['cat-file', 'blob', spec]);
  return result.status === 0 ? result.stdout : null;
}

function report(title, problems) {
  if (!problems.length) return false;
  console.error(`\n  X ${title}:\n`);
  for (const problem of problems) console.error('    ' + problem.replace(/\n/g, '\n      '));
  console.error('\n    The rule and the human path: docs/agents-md.md (J241).\n');
  return true;
}

function lintTree(root) {
  const read = (name) => (existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8') : null);
  return [...lintAgents(read('AGENTS.md')), ...lintClaude(read('CLAUDE.md'))];
}

/**
 * The new commit's parents: HEAD, plus MERGE_HEAD's commits while a merge
 * is being concluded. An amend is judged against HEAD here; the commit it
 * replaces is not visible to this hook, so pre-push re-judges every
 * outgoing commit against its real parents.
 */
function parentsOfNewCommit() {
  const parents = run(['rev-parse', '--verify', '--quiet', 'HEAD']).status === 0 ? ['HEAD'] : [];
  const mergeHead = run(['rev-parse', '--git-path', 'MERGE_HEAD']).stdout.trim();
  if (mergeHead && existsSync(mergeHead)) parents.push(...readFileSync(mergeHead, 'utf8').split('\n').filter(Boolean));
  return parents;
}

function commitMode(messageFile) {
  const parents = parentsOfNewCommit().map((rev) => show(`${rev}:AGENTS.md`));
  const head = parents[0] ?? null;
  const staged = show(':AGENTS.md');
  // A repo that never had AGENTS.md (a bootstrap, a test sandbox) is left to `lint` on CI.
  let shape = [];
  if (staged !== null) shape = lintAgents(staged);
  else if (parents.some((before) => before !== null)) shape = ['This commit deletes AGENTS.md. Every repo keeps one (J241).'];
  if (report('commit blocked: AGENTS.md / CLAUDE.md shape (J241)', [...shape, ...lintClaude(show(':CLAUDE.md'))])) return 1;
  const ai = isAiMessage(readFileSync(messageFile, 'utf8'));
  return report('commit blocked: agents edit AGENTS.md only below the marker (J241)', guardMerge(parents.length ? parents : [null], staged, { ai })) ? 1 : 0;
}

function pushMode(input) {
  const problems = [];
  for (const [, local, , remote] of input.split('\n').filter(Boolean).map((line) => line.split(' '))) {
    if (!local || /^0+$/.test(local)) continue;
    const range = remote && !/^0+$/.test(remote) ? `${remote}..${local}` : local;
    // The shape at the pushed tip. A tip without AGENTS.md passes only if its history never had one (a bootstrap).
    const tip = show(`${local}:AGENTS.md`);
    const gone = tip === null && run(['rev-list', '-1', '--full-history', local, '--', 'AGENTS.md']).stdout.trim() !== '';
    const shape = [
      ...(tip !== null ? lintAgents(tip) : gone ? ['This push deletes AGENTS.md. Every repo keeps one (J241).'] : []),
      ...lintClaude(show(`${local}:CLAUDE.md`)),
    ];
    problems.push(...shape.map((problem) => `${local.slice(0, 9)} ${problem}`));
    // Every outgoing commit, merges included, that changes AGENTS.md against a parent.
    // Real parents, not the path-rewritten ones `--parents` would give.
    for (const sha of run(['rev-list', '--full-history', range, '--', 'AGENTS.md']).stdout.split('\n').filter(Boolean)) {
      const ai = isAiMessage(run(['log', '-1', '--format=%B', sha]).stdout);
      const parents = run(['show', '-s', '--format=%P', sha]).stdout.trim().split(' ').filter(Boolean);
      const before = parents.length ? parents.map((parent) => show(`${parent}:AGENTS.md`)) : [null];
      const refused = guardMerge(before, show(`${sha}:AGENTS.md`), { ai });
      if (refused.length) problems.push(`${sha.slice(0, 9)} ${refused.join('\n')}`);
    }
  }
  return report('push blocked: AGENTS.md (J241)', problems) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, arg] = process.argv.slice(2);
  const root = run(['rev-parse', '--show-toplevel']).stdout.trim() || process.cwd();
  if (mode === 'lint') process.exit(report('AGENTS.md / CLAUDE.md shape (J241)', lintTree(root)) ? 1 : 0);
  else if (mode === 'commit' && arg) process.exit(commitMode(arg));
  else if (mode === 'push') process.exit(pushMode(readFileSync(0, 'utf8')));
  console.error('usage: agents-md.mjs lint | commit <message-file> | push < ref-lines');
  process.exit(2);
}
