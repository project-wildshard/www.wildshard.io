#!/usr/bin/env node
// PreToolUse(Bash) guard, for Claude Code and Codex alike (meta QA 11-25 row 24). On 2026-11-25 ~08:44 UTC a lane ran
// `pkill -f "node --test --test-reporter=dot .githooks"` to stop its own commit's hook tests, and the pattern matched
// every lane's commit hooks on the machine. Agents share one machine: a kill by pattern reaches other lanes' work.
// This refuses `pkill` and `killall` as a command word (after env assignments or a wrapper such as sudo, timeout or
// xargs, or inside $( ), ( ) or backticks). Quoted text is text: `echo "pkill x"` passes.
// The way through: `kill <pid>` for a process you started, or `node .agents/hooks/session-cleanup.mjs --sweep --kill`
// for what an ended session left. Escape hatch (J381): ALLOW_PKILL=1 in the command. Bad input prints nothing and
// exits 0: a hook must never break a session.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readPayload } from './lib/payload.mjs';

const WRAPPER = '(?:sudo(?:\\s+-\\S+)*|timeout\\s+\\S+|nohup|exec|command|time|env|nice(?:\\s+-n\\s*\\S+)?|xargs(?:\\s+-\\S+)*)';
const KILLER = new RegExp(`^\\s*(?:\\w+=\\S*\\s+)*(?:${WRAPPER}\\s+(?:\\w+=\\S*\\s+)*)*(?:\\S*/)?(pkill|killall)(?:\\s|$)`, 'u');

/** Replace quoted strings with a placeholder, so a message's `;` or `pkill` reads as text. @param {string} command */
const unquote = (command) => command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/gu, '__Q__');

/**
 * The kill-by-pattern tool a shell command runs (`pkill` or `killall`), or null.
 * @param {string} command @returns {string | null}
 */
export function killsByPattern(command) {
  if (typeof command !== 'string' || /(?:^|\s)ALLOW_PKILL=1(?:\s|$)/u.test(command)) return null;
  for (const segment of unquote(command).split(/&&|\|\||[;&|\n]|\$\(|[(`)]/u)) {
    const match = KILLER.exec(segment);
    if (match) return match[1] ?? null;
  }
  return null;
}

/** The refusal text: what happened, the way through, and the escape hatch. @param {string} tool */
export function refusal(tool) {
  return [
    `BLOCKED by .agents/hooks/pkill-guard.mjs: \`${tool}\` kills by name or pattern.`,
    '',
    'Lanes share this machine, so a pattern reaches other lanes\' work too (meta QA 11-25 row 24: a `pkill -f` of',
    'hook tests on 2026-11-25 stopped other lanes\' commits). Kill only what you started:',
    '  - `kill <pid>` with the pid you started (pgrep -fl <pattern> lists candidates; check each is yours);',
    '  - `node .agents/hooks/session-cleanup.mjs --sweep --kill` for what an ended session left.',
    'Escape hatch, when a pattern kill is truly needed: put ALLOW_PKILL=1 in front of the command and say why.',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let tool = null;
  try {
    const { tool: kind, command } = readPayload(readFileSync(0, 'utf8'));
    tool = kind === 'shell' ? killsByPattern(command) : null;
  } catch {
    tool = null;
  }
  if (tool !== null) {
    process.stderr.write(`${refusal(tool)}\n`);
    process.exit(2);
  }
}
