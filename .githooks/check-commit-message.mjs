// Commit-message rules (docs/dev.md):
//   - Conventional Commits subject `type(scope): summary`, at most 50
//     characters, no trailing period, blank line before the body.
//   - Body and trailers wrapped at 72 (a lone long token such as a URL
//     is allowed).
//   - AI commits end with exactly one `Assisted-by: AGENT:MODEL`
//     trailer in the final trailer block, AGENT exactly `Claude` or
//     `Codex` (not `Claude Code`, `Claude-Code` or `claude`; meta
//     META-CLEAN-2 C7). No `Co-Authored-By:` for an AI and no
//     "Generated with" / robot banners.
// SKIP_ATTRIB=1 drops only the trailer requirement (human-only commit).
//   - An escape hatch is named (J381, meta QA 11-25 row 51): a commit made
//     while any SKIP_* or ALLOW_* variable is set names that variable in
//     its body with a reason (its paragraph holds five more words).
//     pre-push holds a push made with one to the same rule over its
//     outgoing commits (check-push.mjs). SKIP_PEERS only quiets output.
// Git-generated merge / revert / fixup / squash / amend messages skip.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const TYPES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'perf', 'build', 'ci', 'style', 'revert'];
const SUBJECT = new RegExp(`^(?:${TYPES.join('|')})(?:\\([a-z0-9][a-z0-9._/-]*\\))?!?: \\S.*$`);
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: \S.*$/;
export const AGENTS = ['Claude', 'Codex'];
const ASSISTED = new RegExp(`^Assisted-by: (${AGENTS.join('|')}):(\\S+)$`);
const FORM = 'Assisted-by: Claude:<model> or Assisted-by: Codex:<model>, e.g. Assisted-by: Claude:claude-opus-5-5';
const PLACEHOLDER = /^(unknown|actual-model|model|model_version|latest|default|auto|n\/a|null|undefined)$/i;
const AI = /claude|codex|chatgpt|openai|anthropic|cursor|copilot|gemini/i;
const SCISSORS = /^# -+ >8 -+$/;

const length = (line) => Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(line)).length;

/** Drop comments and everything below a `commit -v` scissors line. */
export function clean(raw) {
  const lines = [];
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (SCISSORS.test(line)) break;
    if (!line.startsWith('#')) lines.push(line.trimEnd());
  }
  while (lines.length && !lines.at(-1)) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines;
}

/** @returns {string | null} the first rule broken, or null when the message passes. */
export function validate(raw, { human = false } = {}) {
  const lines = clean(raw);
  if (!lines.length) return 'Commit message is empty.';
  const subject = lines[0];
  if (/^(Merge |Revert "|fixup! |squash! |amend! )/.test(subject)) return null;

  if (!SUBJECT.test(subject)) {
    return `Use a Conventional Commits subject: type(scope): summary, with type one of ${TYPES.join(', ')}.`;
  }
  if (length(subject) > 50) return `Subject is ${length(subject)} characters; at most 50.`;
  if (subject.endsWith('.')) return 'Subject must not end with a period.';
  if (lines.length > 1 && lines[1] !== '') return 'Separate the subject and body with a blank line.';

  for (const line of lines.slice(2)) {
    if (length(line) > 72 && /\s/.test(line.trim())) return `Wrap the body at 72 characters: "${line.slice(0, 40)}…"`;
  }
  if (lines.some((line) => /🤖|generated (with|by) .*(claude|codex|chatgpt|cursor|copilot)/i.test(line))) {
    return 'Do not add AI generation banners.';
  }
  if (lines.some((line) => /^co-authored-by:/i.test(line) && AI.test(line))) {
    return 'Use Assisted-by, not Co-Authored-By, for AI agents.';
  }

  const assisted = lines.filter((line) => /^assisted-by:/i.test(line));
  if (!assisted.length) return human ? null : `End AI commits with ${FORM} (SKIP_ATTRIB=1 for a human-only commit).`;
  if (assisted.length > 1) return 'Use exactly one Assisted-by trailer.';

  const at = lines.indexOf(assisted[0]);
  let start = at;
  while (start > 0 && lines[start - 1] !== '') start--;
  const block = lines.slice(start);
  if (start < 2 || !block.every((line) => TRAILER.test(line))) {
    return 'Assisted-by must sit in the final trailer block, after a blank line.';
  }
  const match = ASSISTED.exec(assisted[0]);
  if (!match) return `Sign as ${FORM}; the agent name is exactly Claude or Codex.`;
  if (PLACEHOLDER.test(match[2])) return `Use the real model, not "${match[2]}".`;
  return null;
}

/** Variables that only quiet output, not a check. */
const QUIET = new Set(['SKIP_PEERS']);

/** The escape hatches set in `env`: SKIP_* and ALLOW_* with a value other than empty or 0. */
export function hatchesSet(env = process.env) {
  return Object.entries(env)
    .filter(([name, value]) => /^(?:SKIP|ALLOW)_[A-Z0-9_]+$/u.test(name) && !QUIET.has(name) && value !== undefined && value !== '' && value !== '0')
    .map(([name]) => name)
    .sort();
}

/** The hatches in `names` that `raw`'s body does not name with a reason: a body paragraph that holds the name and
 * five more words. Git's own merge, revert, fixup and squash messages pass. @param {string} raw @param {string[]} names */
export function unnamedHatches(raw, names) {
  const lines = clean(raw);
  if (!lines.length || /^(Merge |Revert "|fixup! |squash! |amend! )/.test(lines[0])) return [];
  const paragraphs = lines.slice(1).join('\n').split(/\n\s*\n/u)
    .filter((text) => text.trim() !== '' && !text.trim().split('\n').every((line) => TRAILER.test(line)));
  const words = (text) => text.split(/\s+/u).filter((word) => /[A-Za-z]/u.test(word)).length;
  return names.filter((name) => !paragraphs.some((text) => new RegExp(`\\b${name}\\b`, 'u').test(text) && words(text.replaceAll(name, '')) >= 5));
}

/** The refusal for hatches a message leaves unnamed, or null. @param {string[]} unnamed */
export function hatchRefusal(unnamed) {
  if (!unnamed.length) return null;
  const one = unnamed.length === 1;
  return `${unnamed.join(', ')} ${one ? 'is' : 'are'} set, so name ${one ? 'it' : 'each'} in the body with its reason (J381), e.g. "${unnamed[0]}=1: <what it skips and why>".`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: check-commit-message.mjs <message-file>');
    process.exit(2);
  }
  const raw = readFileSync(file, 'utf8');
  const error = validate(raw, { human: process.env.SKIP_ATTRIB === '1' }) ?? hatchRefusal(unnamedHatches(raw, hatchesSet()));
  if (error) {
    console.error(`\n  X commit blocked: ${error}\n    See docs/dev.md.\n`);
    process.exit(1);
  }
}
