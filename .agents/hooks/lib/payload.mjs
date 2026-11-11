#!/usr/bin/env node
// One reader for the hook JSON both agent tools send on stdin, so every
// hook script in .agents/hooks/ works under Claude Code and Codex CLI.
//
//   node .agents/hooks/lib/payload.mjs command   the shell command, if any
//   node .agents/hooks/lib/payload.mjs paths     edited files, one per line
//   node .agents/hooks/lib/payload.mjs session   the session id
//
// Shapes, recorded from real sessions on 2026-11-10 (Claude Code, and
// codex-cli 0.167.1); the fixtures are in .agents/hooks/test/fixtures/:
//   shell  Both: tool_name "Bash", tool_input.command.
//   edit   Claude: tool_name Edit, Write or MultiEdit with
//          tool_input.file_path; NotebookEdit with notebook_path.
//          Codex: tool_name "apply_patch", tool_input.command holding
//          the patch; each "*** Add File:", "*** Update File:",
//          "*** Delete File:" and "*** Move to:" line names a path.
// Relative paths resolve against the payload's cwd. Bad or empty input
// prints nothing and exits 0: a hook must never break a session.
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLAUDE_EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const PATCH_PATH = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value : '');

/** The paths an apply_patch body touches, in order, without duplicates. */
export function patchPaths(patch) {
  const found = [];
  for (const line of text(patch).split('\n')) {
    const match = PATCH_PATH.exec(line.replace(/\r$/, ''));
    if (match && !found.includes(match[1].trim())) found.push(match[1].trim());
  }
  return found;
}

/**
 * What a hook needs from one payload, whichever tool sent it.
 * @returns {{ tool: 'shell'|'edit'|'', command: string, paths: string[], session: string }}
 */
export function readPayload(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { tool: '', command: '', paths: [], session: '' };
  }
  if (!isObject(payload)) return { tool: '', command: '', paths: [], session: '' };
  const input = isObject(payload.tool_input) ? payload.tool_input : {};
  const name = text(payload.tool_name);
  const cwd = text(payload.cwd) || process.cwd();
  const session = text(payload.session_id);
  const absolute = (path) => (isAbsolute(path) ? path : resolve(cwd, path));
  if (name === 'Bash') return { tool: 'shell', command: text(input.command), paths: [], session };
  if (name === 'apply_patch') {
    const patch = text(input.command) || text(input.patch) || text(input.input);
    return { tool: 'edit', command: '', paths: patchPaths(patch).map(absolute), session };
  }
  if (CLAUDE_EDITS.has(name)) {
    const path = text(input.file_path) || text(input.notebook_path);
    return { tool: 'edit', command: '', paths: path ? [absolute(path)] : [], session };
  }
  return { tool: '', command: '', paths: [], session };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const field = process.argv[2];
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  const payload = readPayload(raw);
  if (field === 'command' && payload.command) process.stdout.write(payload.command);
  else if (field === 'paths' && payload.paths.length) process.stdout.write(`${payload.paths.join('\n')}\n`);
  else if (field === 'session' && payload.session) process.stdout.write(payload.session);
  else if (!['command', 'paths', 'session'].includes(field ?? '')) {
    process.stderr.write('usage: payload.mjs command|paths|session < hook.json\n');
    process.exit(2);
  }
}
