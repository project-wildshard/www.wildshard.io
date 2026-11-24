#!/usr/bin/env node
// PreToolUse(Bash) guard, for Claude Code and Codex alike (meta QA-FEEDBACK-2026-11-24 row 49). Jake, 2026-11-24 ~16:50
// Cancún, after a lane booted the iOS Simulator for a Driftwood fps run and its WebKit played game audio on his
// speakers: "NO FUCKING SOUND IN HEADLESS CHROME", "NEVER FUCKING SOUND SOUND OFF". No agent run makes a sound. This
// refuses:
//   - booting or driving the iOS Simulator: `simctl boot|launch|openurl`, `open -a Simulator`, `open …/Simulator.app`,
//     `idb boot|launch|open` (the Simulator has no command-line mute; phone proof is headless, muted Playwright);
//   - a Chromium or Chrome binary run by hand without `--mute-audio`;
//   - `playwright open|codegen|cr|wk|ff|…` (a headed browser with sound on);
//   - agent-browser `--args` / `AGENT_BROWSER_ARGS` that replace the config's `--mute-audio` and lack it;
//   - `open` of a game page (localhost or *.wildshard.io) in a desktop browser;
//   - `afplay` and `say`.
// Text inside quotes, and read-only command words (grep, cat, git …), never count. Scripts run by name (node x.mjs)
// are not read here: engine's shared browser launcher mutes the page itself when the agent marker is set.
// Escape hatch (J381): ALLOW_AGENT_SOUND=1 in the command, only on Jake's word. Bad input prints nothing and exits 0: a
// hook must never break a session.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readPayload } from './lib/payload.mjs';

/** Leading env assignments and wrappers before the command word. */
const PREFIX = /^(?:(?:export\s+)?\w+=\S*\s+|(?:sudo|nohup|exec|command|time|env|caffeinate(?:\s+-\w+)*|timeout\s+\S+|npx(?:\s+-y)?|pnpm\s+(?:exec|dlx)|bunx)\s+)*/iu;
/** Chromium-family binaries, by file name. */
const CHROMIUM = /^(?:chrome|chromium|chromium-browser|chrome-headless-shell|google[- ]chrome(?:-stable| for testing| canary)?)$/iu;
const PLAYWRIGHT_HEADED = /^(?:open|codegen|cr|chromium|wk|webkit|ff|firefox)$/iu;
const GAME_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|(?:[\w-]+\.)*wildshard\.io)(?=[:/?#\s"']|$)/iu;

/**
 * Replace quoted strings with placeholders, so a message's `;` or `simctl boot` reads as text, not a command.
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

/**
 * Why a shell command would make a sound on Jake's Mac, or null when it would not.
 * @param {string} command @returns {string | null}
 */
export function makesSound(command) {
  if (/(?:^|\s)ALLOW_AGENT_SOUND=1(?:\s|$)/u.test(command)) return null;
  const { bare, quoted } = unquote(command);
  // A command word also starts after $( ( or a backtick.
  for (const raw of bare.split(/&&|\|\||[;&|\n]|\$\(|[(`]/u)) {
    const head = raw.trim();
    if (!head) continue;
    const segment = requote(head, quoted);
    const prefix = PREFIX.exec(head)?.[0] ?? '';
    const [first = '', ...rest] = head.slice(prefix.length).split(/\s+/u);
    const cmd = requote(first, quoted);
    const name = cmd.split('/').pop() ?? '';
    const args = rest.map((arg) => requote(arg, quoted));
    const argText = args.join(' ');
    if (name === 'simctl' || (name === 'xcrun' && args[0] === 'simctl')) {
      const verb = name === 'simctl' ? args[0] : args[1];
      if (/^(?:boot|launch|openurl)$/u.test(verb ?? '')) return 'the iOS Simulator plays game audio on the Mac\'s speakers and has no mute';
    }
    if (name === 'idb' && /^(?:boot|launch|open)$/u.test(args[0] ?? '')) return 'the iOS Simulator plays game audio on the Mac\'s speakers and has no mute';
    if (name === 'open') {
      const app = args.findIndex((arg) => arg === '-a');
      if ((app >= 0 && /(?:^|\/)Simulator(?:\.app)?$/u.test(args[app + 1] ?? '')) || args.some((arg) => /Simulator\.app\/?$/u.test(arg))) {
        return 'the iOS Simulator plays game audio on the Mac\'s speakers and has no mute';
      }
      if (args.some((arg) => GAME_URL.test(arg))) return '`open` of a game page plays its audio in a desktop browser';
      continue;
    }
    if (name === 'playwright' && PLAYWRIGHT_HEADED.test(args[0] ?? '')) return '`playwright open`/`codegen` opens a headed browser with sound on';
    if (name === 'afplay' || name === 'say') return '`afplay`/`say` play through the speakers';
    if (CHROMIUM.test(name) && !segment.includes('--mute-audio')) return 'a Chromium launch without --mute-audio';
    const argsOverride = (name === 'agent-browser' && args.some((arg) => arg === '--args' || arg.startsWith('--args=')))
      || /(?:^|\s)AGENT_BROWSER_ARGS=/u.test(head);
    if (argsOverride && !segment.includes('--mute-audio') && !argText.includes('--mute-audio')) {
      return 'agent-browser --args / AGENT_BROWSER_ARGS replaces the config\'s --mute-audio and lacks it';
    }
  }
  return null;
}

/** The refusal text: what happened, the way through, and the escape hatch. @param {string} reason */
export function refusal(reason) {
  return [
    `BLOCKED by .agents/hooks/no-sound-guard.mjs: ${reason}.`,
    '',
    'No sound from agent runs, ever (Jake, 2026-11-24: "NEVER FUCKING SOUND SOUND OFF"). Never boot the iOS',
    'Simulator; prove phone layouts on headless Playwright WebKit or Chromium at 402 x 874. Every Chromium launch',
    'passes --mute-audio (with --use-mock-keychain --password-store=basic), headless.',
    'Escape hatch, only on Jake\'s word: put ALLOW_AGENT_SOUND=1 in front of the command.',
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
    const { tool, command } = readPayload(raw);
    reason = tool === 'shell' ? makesSound(command) : null;
  } catch {
    reason = null;
  }
  if (reason !== null) {
    process.stderr.write(`${refusal(reason)}\n`);
    process.exit(2);
  }
}
