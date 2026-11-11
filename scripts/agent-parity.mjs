#!/usr/bin/env node
// Agent tooling parity: do Claude Code and Codex CLI load the same rules,
// skills, hooks and settings in this repo, from one source?
// (Jake, 2026-11-10; meta docs/plans/MULTI-AGENT-TOOLING-PLAN.md.)
//
//   node scripts/agent-parity.mjs [--root <dir>] [--kit <repo-kit>] [--json] [--strict]
//
// --kit also compares each kit-owned piece (the kit's skills, .agents/hooks/,
// the hook spec and these two scripts) with the kit's bytes: `drift` when
// they differ or still sit in the old .claude/ layout, `missing` when absent.
// The repo's own skills and hook scripts are `accepted` when listed under
// "owned" in .agents/parity.json, else `drift`.
//
// Report-only by default: prints one line per item and exits 0. With
// --strict it exits 1 when any item is refused (the rollout turns this on
// per repo once its layout is fixed). Exit 2 is a usage error.
//
// Where each tool reads from (codex-cli 0.167.1, Claude Code, 2026-11-10):
//   rules     Claude: CLAUDE.md (here always `@AGENTS.md`, J241). Codex: AGENTS.md.
//   skills    Claude: .claude/skills/<name>/SKILL.md. Codex: .agents/skills/<name>/SKILL.md.
//   hooks     Claude: .claude/settings.json "hooks". Codex: .codex/hooks.json.
//   settings  Claude: .claude/settings.json other keys. Codex: .codex/config.toml.
//   mcp       Claude: .mcp.json. Codex: [mcp_servers.<name>] in .codex/config.toml.
//   commands  Claude: .claude/commands/*.md. Codex has no repo-level prompts.
//   agents    Claude: .claude/agents/*.md. Codex: .codex/agents/*.toml.
//   githooks  .githooks/ through core.hooksPath: Git runs them for both.
//
// Statuses. Passing: `same` (one file or directory, both tools load it),
// `paired` (both sides exist, formats differ, not compared byte for byte),
// `shared` (one thing both tools hit) and `accepted` (one-sided, with a
// reason in .agents/parity.json). Refused under --strict: `claude-only`,
// `codex-only`, `copy` (identical bytes kept twice by hand), `drift`
// (copies or registrations that differ), `broken` (points at nothing, or a
// tool can't load it), `inline` (a hook that runs no repo script) and
// `missing`. No input makes report mode crash: an unreadable or unparsable
// file is a `broken` item.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PASSING = new Set(['same', 'paired', 'shared', 'accepted']);
export const ONE_SIDED = new Set(['claude-only', 'codex-only']);
export const STATUSES = ['same', 'paired', 'shared', 'accepted', 'claude-only', 'codex-only', 'copy', 'drift', 'broken', 'inline', 'missing'];
export const REFUSED = STATUSES.filter((status) => !PASSING.has(status));
export const EXCEPTIONS = '.agents/parity.json';
/** Codex's default `project_doc_max_bytes`; a repo's .codex/config.toml may set its own. */
export const CODEX_DOC_BYTES = 32 * 1024;

/** Hook events each tool fires. Codex's list is read from the 0.167.1 binary's HookEvent enum. */
export const EVENTS = {
  claude: new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact']),
  codex: new Set(['PreModelRequest', 'PostModelRequest', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt']),
};
/** Claude settings keys and the Codex config.toml keys that carry the same concept. */
export const SETTING_MAP = {
  permissions: ['sandbox_mode', 'approval_policy', 'rules'],
  env: ['shell_environment_policy'],
  model: ['model'],
};
const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'node', 'python', 'python3']);
const TOOLS = { claude: 'Claude Code', codex: 'Codex' };

// ---------------------------------------------------------------- file access

/** Never throws: `{ text }`, `{ text: null }` when absent, or `{ text: null, error }` when unreadable. */
function readText(path) {
  try {
    return { text: readFileSync(path, 'utf8'), error: null };
  } catch (error) {
    return { text: null, error: error.code === 'ENOENT' || error.code === 'ENOTDIR' ? null : `${error.code ?? 'error'} reading ${path}` };
  }
}
const read = (path) => readText(path).text;
const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};
/** Directory names, sorted; `[]` when absent. An unreadable directory throws, and the audit step reports it as broken. */
const list = (dir) => {
  try {
    return readdirSync(dir).filter((name) => name !== '.DS_Store').sort();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw Object.assign(new Error(`${error.code ?? 'error'} listing ${dir}`), { code: error.code });
  }
};
const parseJson = (text) => {
  if (text === null) return { value: null, error: null };
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    const at = /position (\d+)/.exec(error.message);
    return { value: null, error: at ? `invalid JSON at line ${text.slice(0, Number(at[1])).split('\n').length}` : 'invalid JSON' };
  }
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const run = (args, cwd) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.error || result.status !== 0 ? '' : (result.stdout ?? '').trim();
};

/**
 * Content hash of a file or a directory tree (relative paths and bytes; symlinks followed, each real
 * directory once; .DS_Store skipped). Throws with the unreadable path; callers turn that into `broken`.
 */
export function hashPath(path) {
  const hash = createHash('sha256');
  const seen = new Set();
  const walk = (dir, prefix) => {
    const here = realpathSync(dir);
    if (seen.has(here)) return;
    seen.add(here);
    for (const name of readdirSync(dir).sort()) {
      if (name === '.DS_Store' || name === '__pycache__') continue;
      const full = join(dir, name);
      if (isDir(full)) walk(full, `${prefix}${name}/`);
      else if (existsSync(full)) hash.update(`${prefix}${name}\0`).update(readFileSync(full)).update('\0');
      else hash.update(`${prefix}${name}\0dangling\0`);
    }
  };
  if (isDir(path)) walk(path, '');
  else hash.update(readFileSync(path));
  return hash.digest('hex');
}
const tryHash = (path) => {
  try {
    return { hash: hashPath(path), error: null };
  } catch (error) {
    return { hash: null, error: `${error.code ?? 'error'} hashing ${error.path ?? path}` };
  }
};

// ---------------------------------------------------------------- parsers

const unquote = (value) => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return { value: JSON.parse(value), ok: true };
    } catch {
      return { value: null, ok: false };
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return { value: value.slice(1, -1).replace(/''/g, "'"), ok: true };
  return { value, ok: !/^["']/.test(value) };
};

/** Index of the quote closing a YAML quoted scalar that opens at 0, or -1 when it doesn't close. */
function quoteEnd(value) {
  const quote = value[0];
  for (let k = 1; k < value.length; k++) {
    if (quote === '"' && value[k] === '\\') k++;
    else if (quote === "'" && value[k] === "'" && value[k + 1] === "'") k++;
    else if (value[k] === quote) return k;
  }
  return -1;
}

/** A YAML value with its trailing comment removed; a `#` inside quotes, or not after a space, is text. */
function stripYamlComment(text) {
  const value = text.trim();
  if (value.startsWith('#')) return '';
  const quote = value[0] === '"' || value[0] === "'" ? value[0] : null;
  if (quote) {
    let k = 1;
    for (; k < value.length; k++) {
      if (quote === '"' && value[k] === '\\') k++;
      else if (quote === "'" && value[k] === "'" && value[k + 1] === "'") k++;
      else if (value[k] === quote) break;
    }
    if (k >= value.length) return value; // unclosed: unquote() refuses it
    const rest = value.slice(k + 1).trim();
    return rest === '' || rest.startsWith('#') ? value.slice(0, k + 1) : value; // text after the quote: refused below
  }
  return value.replace(/\s+#.*$/, '').trim();
}

/**
 * The top-level scalars of a SKILL.md / agent frontmatter block: `{ fields, error }`. Plain, quoted and
 * block (`|`, `>`) scalars become strings; a key whose value is a mapping or list maps to `null`.
 * Malformed lines are an error, so a value never borrows from the next line.
 */
export function parseFrontmatter(text) {
  const match = (text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { fields: null, error: 'no frontmatter' };
  const lines = match[1].split(/\r?\n/);
  const fields = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^\s/.test(line)) return { fields: null, error: `frontmatter line ${i + 2} is indented with no key above it` };
    const pair = line.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (!pair) return { fields: null, error: `frontmatter line ${i + 2} does not parse` };
    const [, key] = pair;
    const rest = (pair[2] ?? '').trim();
    // A quote that doesn't close on this line may close on a continuation line: keep it whole for folding.
    const raw = /^["']/.test(rest) && quoteEnd(rest) === -1 ? rest : stripYamlComment(rest);
    const nested = [];
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) nested.push(lines[++i]);
    if (/^[|>][+-]?\d*$/.test(raw)) {
      // Block scalar: strip the common indent, then literal (|) keeps lines and folded (>) joins
      // them with spaces, a blank line being a newline; chomping (-, +, or clip) sets the end.
      let end = nested.length;
      while (end > 0 && nested[end - 1].trim() === '') end--;
      const body = nested.slice(0, end);
      const indent = Math.min(...body.filter((row) => row.trim()).map((row) => /^\s*/.exec(row)[0].length));
      const rows = body.map((row) => (row.trim() === '' ? '' : row.slice(indent)));
      let value = '';
      if (raw.startsWith('|')) value = rows.join('\n');
      else for (const row of rows) value += row === '' ? '\n' : `${value !== '' && !value.endsWith('\n') ? ' ' : ''}${row}`;
      const chomp = raw.includes('-') ? 'strip' : raw.includes('+') ? 'keep' : 'clip';
      if (value !== '' && chomp !== 'strip') value += '\n'.repeat(chomp === 'keep' ? nested.length - end + 1 : 1);
      fields[key] = value;
    } else if (raw === '') {
      fields[key] = nested.some((row) => row.trim()) ? null : '';
    } else if (/^[[{&*!]/.test(raw) || /^(null|~)$/i.test(raw)) {
      fields[key] = null;
    } else {
      // A scalar may continue on indented lines; YAML folds them with single spaces.
      const folded = [raw, ...nested.map((row) => row.trim()).filter(Boolean)].join(' ');
      const { value, ok } = unquote(/^["']/.test(raw) ? folded : stripYamlComment(folded));
      if (!ok) return { fields: null, error: `frontmatter key ${key} has an unclosed quote` };
      fields[key] = value;
    }
  }
  return { fields, error: null };
}
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

const TOML_ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
const DEC = String.raw`(?:0|[1-9](?:_?\d)*)`;
const DIGITS = String.raw`\d(?:_?\d)*`;
const BARE_VALUE = new RegExp(String.raw`^(?:true|false|[+-]?(?:inf|nan)|\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?|0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*|[+-]?${DEC}(?:\.${DIGITS})?(?:[eE][+-]?${DIGITS})?)(?=[\s,\]}#]|$)`);

/**
 * Enough TOML to know what a config declares: every key path, with string values decoded and bare values
 * (numbers, booleans, dates) kept raw, or an error. Covers headers, array tables, dotted and quoted keys,
 * the four string forms with TOML escapes, arrays (commas required) and inline tables, and refuses
 * duplicate keys. Error messages name a line and a reason, never a value.
 */
export function parseToml(text) {
  const entries = new Map();
  const src = text ?? '';
  let i = 0;
  const fail = (why) => ({ entries, error: `line ${src.slice(0, i).split('\n').length}: ${why}` });
  const oops = (why) => {
    throw new Error(why);
  };
  const skipSpace = () => {
    while (src[i] === ' ' || src[i] === '\t') i++;
  };
  // Whitespace, newlines and comments, as allowed between array elements and between statements.
  const skipBlank = () => {
    for (;;) {
      skipSpace();
      if (src[i] === '#') while (i < src.length && src[i] !== '\n') i++;
      else if (src[i] === '\n' || (src[i] === '\r' && src[i + 1] === '\n')) i += src[i] === '\r' ? 2 : 1;
      else return;
    }
  };
  const endOfLine = (what) => {
    skipSpace();
    if (src[i] === '#') while (i < src.length && src[i] !== '\n') i++;
    if (src[i] === '\r') i++;
    if (i < src.length && src[i] !== '\n') oops(`text after ${what}`);
  };
  const decodeBasic = (body, multi) => {
    let out = '';
    for (let k = 0; k < body.length; k++) {
      if (body[k] !== '\\') {
        out += body[k];
        continue;
      }
      const next = body[++k];
      if (next in TOML_ESCAPES) out += TOML_ESCAPES[next];
      else if (next === 'u' || next === 'U') {
        const size = next === 'u' ? 4 : 8;
        const hex = body.slice(k + 1, k + 1 + size);
        const point = /^[0-9A-Fa-f]+$/.test(hex) && hex.length === size ? parseInt(hex, 16) : -1;
        if (point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) oops('bad string escape');
        out += String.fromCodePoint(point);
        k += size;
      } else if (multi && /[ \t\r\n]/.test(next ?? '')) {
        // A line-ending backslash trims the newline and the whitespace after it.
        const rest = body.slice(k).match(/^[ \t]*\r?\n[\s]*/);
        if (!rest) oops('bad string escape');
        k += rest[0].length - 1;
      } else oops('bad string escape');
    }
    return out;
  };
  const scanString = (allowMulti = true) => {
    const quote = src[i];
    if (allowMulti && src.startsWith(quote.repeat(3), i)) {
      const fence = quote.repeat(3);
      let end = src.indexOf(fence, i + 3);
      while (end !== -1 && quote === '"' && /(^|[^\\])(\\\\)*\\$/.test(src.slice(i + 3, end))) end = src.indexOf(fence, end + 1);
      if (end === -1) oops('unclosed multi-line string');
      let close = end + 3;
      while (src[close] === quote && close - end < 5) close++; // up to two quotes may end the body
      const body = src.slice(i + 3, close - 3).replace(/^\r?\n/, '');
      i = close;
      return quote === '"' ? decodeBasic(body, true) : body;
    }
    let k = i + 1;
    while (k < src.length && src[k] !== quote && src[k] !== '\n') k += quote === '"' && src[k] === '\\' ? 2 : 1;
    if (src[k] !== quote) oops('unclosed string');
    const body = src.slice(i + 1, k);
    i = k + 1;
    return quote === '"' ? decodeBasic(body, false) : body;
  };
  const scanKey = () => {
    const parts = [];
    for (;;) {
      skipSpace();
      if (src[i] === '"' || src[i] === "'") parts.push(scanString(false));
      else {
        const match = src.slice(i).match(/^[A-Za-z0-9_-]+/);
        if (!match) oops('bad key');
        parts.push(match[0]);
        i += match[0].length;
      }
      skipSpace();
      if (src[i] !== '.') return parts;
      i++;
    }
  };
  // One value at i: { string } decoded, { raw } for a bare value, {} for an array or inline table.
  // An inline table at `prefix` records its children as entries (inside an array, prefix is null).
  const scanValue = (prefix = null) => {
    if (src[i] === '"' || src[i] === "'") return { string: scanString() };
    if (src[i] === '[') {
      i++;
      for (;;) {
        skipBlank();
        if (i >= src.length) oops('unclosed array');
        if (src[i] === ']') {
          i++;
          return {};
        }
        scanValue(null);
        skipBlank();
        if (src[i] === ',') i++;
        else if (src[i] !== ']') oops(i >= src.length ? 'unclosed array' : 'missing comma in array');
      }
    }
    if (src[i] === '{') {
      i++;
      const seen = new Set();
      skipBlank();
      if (src[i] === '}') {
        i++;
        return {};
      }
      for (;;) {
        const parts = scanKey();
        const key = parts.join('\0');
        if ([...seen].some((other) => other === key || other.startsWith(`${key}\0`) || key.startsWith(`${other}\0`))) oops('duplicate key in inline table');
        seen.add(key);
        if (src[i] !== '=') oops('bad inline table key');
        i++;
        skipSpace();
        const path = prefix && [...prefix, ...parts];
        const child = scanValue(path);
        if (path) entries.set(path.join('\0'), { path, value: child.string ?? null, raw: child.raw ?? null });
        skipBlank();
        if (src[i] === ',') {
          i++;
          skipBlank();
        } else if (src[i] === '}') {
          i++;
          return {};
        } else oops(i >= src.length ? 'unclosed inline table' : 'missing comma in inline table');
      }
    }
    const match = src.slice(i).match(BARE_VALUE);
    if (!match) oops(i >= src.length || /[\r\n#]/.test(src[i]) ? 'empty value' : 'unrecognised value');
    i += match[0].length;
    return { raw: match[0] };
  };
  // Each path's kind: a value, an explicit [table], an [[array]] element, or a table implied by a
  // header ('header') or by a dotted key ('dotted'). TOML refuses redefining any of them.
  const kinds = new Map();
  const implied = (path, kind) => {
    for (let n = 1; n < path.length; n++) {
      const id = path.slice(0, n).join('\0');
      if (kinds.get(id) === 'value') oops(`${path.slice(0, n).join('.')} is already a value`);
      if (!kinds.has(id)) kinds.set(id, kind);
    }
  };
  let section = [];
  // [[array]] elements keep their place: a stored path names each element as `#<n>` after its
  // array's key (MA10 a), so two [[hooks.PreToolUse]] groups stay two. `kinds` stays logical.
  const arrays = new Map();
  // Which positions of a stored path are element markers, so a quoted key that reads "#0" is never one.
  const physical = (logical) => {
    const path = [];
    const elements = [];
    logical.forEach((segment, n) => {
      path.push(segment);
      const id = logical.slice(0, n + 1).join('\0');
      if (arrays.has(id)) {
        elements.push(path.length);
        path.push(`#${arrays.get(id)}`);
      }
    });
    return { path, elements };
  };
  let stored = { path: [], elements: [] };
  try {
    for (;;) {
      skipBlank();
      if (i >= src.length) break;
      if (src[i] === '[') {
        const array = src[i + 1] === '[';
        i += array ? 2 : 1;
        let path;
        try {
          path = scanKey();
        } catch {
          oops('bad table header');
        }
        if (!src.startsWith(array ? ']]' : ']', i)) oops('unclosed table header');
        i += array ? 2 : 1;
        endOfLine('a table header');
        const id = path.join('\0');
        implied(path, 'header');
        const kind = kinds.get(id);
        if (array ? kind !== undefined && kind !== 'array' : kind !== undefined && kind !== 'header') oops('duplicate table');
        if (array) for (const key of [...kinds.keys()]) if (key.startsWith(`${id}\0`)) kinds.delete(key); // a new element
        if (array) {
          for (const key of [...arrays.keys()]) if (key.startsWith(`${id}\0`)) arrays.delete(key); // its own nested arrays restart
          arrays.set(id, (arrays.get(id) ?? -1) + 1);
        }
        kinds.set(id, array ? 'array' : 'table');
        section = path;
        stored = physical(path);
        entries.set(stored.path.join('\0'), { path: stored.path, elements: stored.elements, kind: array ? 'array' : 'table', value: null, raw: null });
        continue;
      }
      const key = scanKey();
      if (src[i] !== '=') oops('expected key = value');
      i++;
      skipSpace();
      if (i >= src.length || /[\r\n#]/.test(src[i])) oops(`key ${key.join('.')} has no value`);
      const path = [...section, ...key];
      const id = path.join('\0');
      implied(path, 'dotted');
      if (kinds.has(id)) oops(`duplicate key ${path.join('.')}`);
      kinds.set(id, 'value');
      const at = [...stored.path, ...key];
      const value = scanValue(at);
      endOfLine('a value');
      entries.set(at.join('\0'), { path: at, elements: stored.elements, kind: 'value', value: value.string ?? null, raw: value.raw ?? null });
    }
  } catch (error) {
    return fail(error.message);
  }
  return { entries, error: null };
}

/** The top-level names a TOML config declares (keys and table heads), for settings pairing. */
export function tomlKeys(text) {
  const { entries, error } = parseToml(text);
  if (error) return new Set();
  return new Set([...entries.values()].map((entry) => entry.path[0]));
}
const tomlValue = (entries, ...path) => entries.get(path.join('\0'))?.value;

// ---------------------------------------------------------------- hooks

const ROOT = '\u0000ROOT';
const CLAUDE_ROOT_FORMS = ['${CLAUDE_PROJECT_DIR}', '$CLAUDE_PROJECT_DIR'];
const GIT_ROOT_FORM = '$(git rev-parse --show-toplevel)';

/**
 * How a hook command runs a repo script, or why it doesn't. Supported shapes: an optional `nohup`,
 * `exec` or `VAR=value` prefix, an optional interpreter (bash, sh, zsh, node, python3) with flags,
 * then the script at the repo root (`$CLAUDE_PROJECT_DIR`, `$(git rev-parse --show-toplevel)`) or a
 * relative path, then plain arguments, output redirections and a trailing `&`. Anything else (pipes,
 * `;`, `&&`, input redirection, other substitutions, absolute paths) is `inline`: the logic lives in
 * the config, not a shared script. Quoting is honoured: a quoted `>` or `&` is text, and only an
 * unquoted or double-quoted, unescaped `$CLAUDE_PROJECT_DIR` is an expansion.
 * @returns {{ script: string|null, runner: string[], args: string[], usesClaudeRoot: boolean, why: string }}
 */
export function invocation(command) {
  let usesClaudeRoot = false;
  const none = (why) => ({ script: null, runner: [], args: [], usesClaudeRoot, why });
  const tokens = [];
  let token = null; // { text, ops }: ops when it holds an unquoted & > or <
  let quote = null;
  const begin = () => {
    token ??= { text: '', ops: false };
    return token;
  };
  for (let k = 0; k < command.length; k++) {
    const char = command[k];
    if (quote === "'") {
      if (char === "'") quote = null;
      else begin().text += char;
      continue;
    }
    if (char === '\\') {
      const next = command[k + 1];
      if (next === undefined) return none('ends with a backslash');
      if (quote === '"' && !'$`"\\\n'.includes(next)) begin().text += char;
      else if (next === '\n') {
        k++;
        continue;
      }
      begin().text += next;
      k++;
      continue;
    }
    if (char === '$') {
      if (command.startsWith(GIT_ROOT_FORM, k)) {
        begin().text += ROOT;
        k += GIT_ROOT_FORM.length - 1;
        continue;
      }
      const form = CLAUDE_ROOT_FORMS.find((candidate) => command.startsWith(candidate, k) && (candidate.endsWith('}') || !/\w/.test(command[k + candidate.length] ?? '')));
      if (form) {
        usesClaudeRoot = true;
        begin().text += ROOT;
        k += form.length - 1;
        continue;
      }
      if (command[k + 1] === '(') return none('uses a command substitution');
      begin().text += char;
      continue;
    }
    if (char === '`') return none('uses a command substitution');
    if (quote === '"') {
      if (char === '"') quote = null;
      else begin().text += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      begin();
      continue;
    }
    if (/\s/.test(char)) {
      if (char === '\n') return none('uses shell syntax (newline)');
      if (token) tokens.push(token);
      token = null;
      continue;
    }
    if (/[;|()<]/.test(char)) return none(`uses shell syntax (${char})`);
    if (char === '&' || char === '>') begin().ops = true;
    begin().text += char;
  }
  if (quote) return none('has an unclosed quote');
  if (token) tokens.push(token);
  if (tokens.some((entry) => entry.ops && (entry.text === '&&' || entry.text === '||'))) return none('chains commands');
  // A trailing `&` and output redirections are allowed; strip them.
  for (;;) {
    const last = tokens.at(-1);
    const before = tokens.at(-2);
    if (last?.ops && /^(?:&|\d?>>?\S+|&>>?\S+|\d?>&\d)$/.test(last.text)) tokens.pop();
    else if (last && !last.ops && before?.ops && /^(?:\d?>>?|&>>?)$/.test(before.text)) tokens.splice(-2, 2); // `> /dev/null`
    else break;
  }
  if (tokens.some((entry) => entry.ops)) return none('uses shell syntax (& or >)');
  const words = tokens.map((entry) => entry.text);
  let at = 0;
  while (at < words.length && (words[at] === 'nohup' || words[at] === 'exec' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at]))) at++;
  if (at < words.length && INTERPRETERS.has(words[at])) {
    at++;
    const interpreter = words[at - 1];
    while (at < words.length && words[at].startsWith('-')) {
      const flag = words[at];
      const shell = ['bash', 'sh', 'zsh'].includes(interpreter) && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag);
      const node = interpreter === 'node' && /^(?:-[a-zA-Z]*[ep][a-zA-Z]*|--eval|--print|--eval=.*|--print=.*)$/.test(flag);
      const python = interpreter.startsWith('python') && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag);
      if (shell || node || python) return none(`runs inline code (${interpreter} ${flag.split('=')[0]})`); // never a flag's value (J206)
      at++;
    }
  }
  const target = words[at];
  if (!target) return none('runs no script');
  let script;
  if (target.startsWith(`${ROOT}/`)) script = target.slice(ROOT.length + 1);
  else if (!target.includes(ROOT) && !isAbsolute(target) && !/^[~$]/.test(target) && target.includes('/')) script = target;
  else return none(isAbsolute(target) || /^[~$]/.test(target) ? 'runs a file outside the repo' : 'runs no repo script');
  script = script.replace(/^(\.\/)+/, '');
  if (!script || script.split('/').includes('..') || script.includes(ROOT)) return none('runs a path outside the repo');
  const shown = (word) => word.split(ROOT).join('@ROOT');
  return { script, runner: words.slice(0, at).map(shown), args: words.slice(at + 1).map(shown), usesClaudeRoot, why: '' };
}

/** The repo script a hook command runs, or null. */
export const scriptOf = (command) => invocation(command).script;

/**
 * A matcher as the set of tools it covers, in one vocabulary per tool pair: Claude's `Edit` and `Write`
 * together (with or without MultiEdit) equal Codex's `apply_patch`; either alone, or NotebookEdit, does not.
 */
export function normalizeMatcher(matcher, tool = 'claude', event = '') {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*' || matcher === '.*') return '*';
  const tools = new Set(String(matcher).replace(/^\^\(?|\)?\$$/g, '').split('|').map((name) => name.replace(/^\^|\$$/g, '').trim()).filter(Boolean));
  if (tool === 'codex' && tools.delete('apply_patch')) tools.add('edit');
  if (tool === 'claude' && tools.has('Edit') && tools.has('Write')) {
    for (const name of ['Edit', 'Write', 'MultiEdit']) tools.delete(name);
    tools.add('edit');
  }
  const names = [...tools].sort();
  if (event === 'SessionStart' && names.join('|') === 'clear|compact|resume|startup') return '*';
  return names.join('|');
}

/** Every hook handler in a hooks object ({ Event: [{ matcher, hooks: [{ type, command }] }] }), with problems. */
export function hookEntries(hooks, tool = 'claude') {
  const entries = [];
  const problems = [];
  if (hooks === undefined || hooks === null) return { entries, problems };
  if (!isObject(hooks)) return { entries, problems: ['"hooks" is not an object'] };
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      problems.push(`${event} is not a list`);
      continue;
    }
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        problems.push(`${event} has a matcher group without a "hooks" list`);
        continue;
      }
      for (const hook of group.hooks) {
        const type = isObject(hook) ? hook.type ?? 'command' : null;
        const matcher = normalizeMatcher(group.matcher, tool, event);
        if (type === 'command' && typeof hook.command === 'string') {
          entries.push({ event, matcher, type, command: hook.command, ...invocation(hook.command) });
        } else {
          const kind = type === 'command' || typeof type !== 'string' ? 'invalid' : type;
          entries.push({ event, matcher, type: kind, command: null, script: null, runner: [], args: [], usesClaudeRoot: false, why: '' });
        }
      }
    }
  }
  return { entries, problems };
}

// ---------------------------------------------------------------- audits

const item = (kind, name, status, extra = {}) => ({ kind, name, status, claude: null, codex: null, scripts: [], note: '', ...extra });

function auditRules(root, docLimit) {
  const items = [];
  const agentsRead = readText(join(root, 'AGENTS.md'));
  const claudePath = join(root, 'CLAUDE.md');
  const claudeRead = readText(claudePath);
  for (const failed of [agentsRead, claudeRead].filter((result) => result.error)) items.push(item('rules', 'AGENTS.md', 'broken', { note: failed.error }));
  if (items.length) return items;
  const agents = agentsRead.text;
  const claude = claudeRead.text;
  const linked = isLink(claudePath) && real(claudePath) === real(join(root, 'AGENTS.md'));
  const pointer = claude !== null && claude.trim() === '@AGENTS.md';
  const sides = { claude: claude === null ? null : 'CLAUDE.md', codex: agents === null ? null : 'AGENTS.md' };
  if (agents === null && claude === null) items.push(item('rules', 'AGENTS.md', 'missing', { note: 'no AGENTS.md or CLAUDE.md' }));
  else if (agents === null) items.push(item('rules', 'AGENTS.md', 'claude-only', { ...sides, note: 'Codex reads AGENTS.md, not CLAUDE.md' }));
  else if (claude === null) items.push(item('rules', 'AGENTS.md', 'codex-only', { ...sides, note: 'Claude Code reads CLAUDE.md; make it `@AGENTS.md`' }));
  else if (linked || pointer) items.push(item('rules', 'AGENTS.md', 'same', { ...sides, note: linked ? 'CLAUDE.md links to AGENTS.md' : 'CLAUDE.md is `@AGENTS.md`' }));
  else if (claude === agents) items.push(item('rules', 'AGENTS.md', 'copy', { ...sides, note: 'CLAUDE.md copies AGENTS.md; make it `@AGENTS.md`' }));
  else items.push(item('rules', 'AGENTS.md', 'drift', { ...sides, note: 'CLAUDE.md holds rules Codex never sees; move them into AGENTS.md' }));
  if (agents !== null && Buffer.byteLength(agents) > docLimit.bytes) {
    items.push(item('rules', 'AGENTS.md size', 'broken', { codex: 'AGENTS.md', note: `${Buffer.byteLength(agents)} bytes; Codex reads only the first ${docLimit.bytes} (${docLimit.source})` }));
  }
  if (existsSync(join(root, 'AGENTS.override.md'))) {
    items.push(item('rules', 'AGENTS.override.md', 'codex-only', { codex: 'AGENTS.override.md', note: 'Codex reads it instead of AGENTS.md; Claude never does' }));
  }
  return items;
}

const skillDirs = (dir) => {
  const found = new Map();
  for (const name of list(dir)) {
    const full = join(dir, name);
    if (isLink(full) && real(full) === null) found.set(name, { path: full, dangling: true });
    else if (isDir(full)) found.set(name, { path: full, dangling: false });
  }
  return found;
};

/** The skill spec's limits (Claude Code's skill docs; codex-cli 0.167.1's skill validator): a hyphen-case name up to 64 characters, a description up to 1024. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;

/** Relative markdown link targets in one skill file that don't exist (anchors, URLs and absolute paths skipped). */
function deadLinks(dir, file) {
  const { text } = readText(join(dir, file));
  if (text === null) return [];
  const dead = [];
  // Links in fenced code and inline code spans are examples or templates, not links.
  let fence = null;
  const prose = text.split('\n').map((line) => {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open && (fence === null || open[1][0] === fence[0] && open[1].length >= fence.length)) {
      fence = fence === null ? open[1] : null;
      return '';
    }
    return fence === null ? line.replace(/(`+)[^`]*?\1/g, '') : '';
  }).join('\n');
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
    let decoded = target;
    try {
      decoded = decodeURI(target);
    } catch {
      // A malformed escape is checked as written.
    }
    if (!existsSync(join(real(dir) ?? dir, decoded))) dead.push(`${file} links to ${target}, which does not exist`);
  }
  return dead;
}

/**
 * Why Codex (or Claude) would not load a skill, or loads it wrong (the skill lint, MA7): SKILL.md parses,
 * `name` is the directory's name in Codex's hyphen-case, `description` is present and within Codex's cap,
 * and every relative link in the skill's top-level markdown files resolves.
 */
function skillProblems(dir, name = basename(dir)) {
  const { text, error } = readText(join(dir, 'SKILL.md'));
  if (error) return [error];
  if (text === null) return ['no SKILL.md'];
  const { fields, error: parseError } = parseFrontmatter(text);
  if (parseError) return [`SKILL.md ${parseError}`];
  const problems = [];
  if (!nonEmpty(fields.name)) problems.push('frontmatter name is missing or empty');
  else if (fields.name.trim() !== name) problems.push(`frontmatter name "${fields.name.trim()}" is not the directory name "${name}"`);
  else if (!SKILL_NAME.test(name) || name.length > SKILL_NAME_MAX) problems.push(`name "${name}" is not hyphen-case within ${SKILL_NAME_MAX} characters`);
  if (!nonEmpty(fields.description)) problems.push('frontmatter description is missing or empty');
  else if (fields.description.trim().length > SKILL_DESCRIPTION_MAX) problems.push(`description is ${fields.description.trim().length} characters; the skill spec allows at most ${SKILL_DESCRIPTION_MAX}`);
  for (const file of list(dir).filter((entry) => entry.endsWith('.md'))) problems.push(...deadLinks(dir, file));
  return problems;
}

function auditSkills(root) {
  const claude = skillDirs(join(root, '.claude/skills'));
  const codex = skillDirs(join(root, '.agents/skills'));
  const items = [];
  for (const name of [...new Set([...claude.keys(), ...codex.keys()])].sort()) {
    const a = claude.get(name);
    const b = codex.get(name);
    const sides = { claude: a ? relative(root, a.path) : null, codex: b ? relative(root, b.path) : null };
    const dangling = [a, b].filter((side) => side?.dangling).map((side) => relative(root, side.path));
    if (dangling.length) {
      items.push(item('skills', name, 'broken', { ...sides, note: `dangling link: ${dangling.join(', ')}` }));
      continue;
    }
    let status;
    let note;
    if (a && b && real(a.path) === real(b.path)) {
      status = 'same';
      note = isLink(b.path) ? '.agents/skills links to .claude/skills' : isLink(a.path) ? '.claude/skills links to .agents/skills' : 'one directory';
    } else if (a && b) {
      const [x, y] = [tryHash(a.path), tryHash(b.path)];
      if (x.error || y.error) {
        items.push(item('skills', name, 'broken', { ...sides, note: x.error ?? y.error }));
        continue;
      }
      status = x.hash === y.hash ? 'copy' : 'drift';
      note = status === 'copy' ? 'two identical directories; make one a symlink to the other' : 'two directories that differ';
    } else {
      status = a ? 'claude-only' : 'codex-only';
      note = a ? 'Codex looks in .agents/skills/' : 'Claude looks in .claude/skills/';
    }
    const problems = [...new Set([a, b].filter(Boolean).flatMap((side) => skillProblems(side.path, name)))];
    if (problems.length && status !== 'drift') {
      status = 'broken';
      note = problems.join('; ');
    }
    items.push(item('skills', name, status, { ...sides, note }));
  }
  return items;
}

function readHooks(root, path, tool) {
  const { text, error } = readText(join(root, path));
  if (error) return { entries: [], problems: [error] };
  const parsed = parseJson(text);
  if (parsed.error) return { entries: [], problems: [`${path} does not parse: ${parsed.error}`] };
  if (parsed.value !== null && !isObject(parsed.value)) return { entries: [], problems: [`${path} is not a JSON object`] };
  const { entries, problems } = hookEntries(parsed.value?.hooks, tool);
  return { entries, problems: problems.map((problem) => `${path}: ${problem}`) };
}

/** A registration without its command text or argument values (configs can carry tokens). */
const describe = (entry) => {
  if (entry.type !== 'command') return `${entry.event} ${entry.matcher}: (${entry.type} handler)`;
  if (!entry.script) return `${entry.event} ${entry.matcher}: inline command ${commandId(entry.command)}`;
  return `${entry.event} ${entry.matcher}: ${[...entry.runner.filter((word) => !word.includes('=')), entry.script].join(' ')}${entry.args.length ? ` (+${entry.args.length} arg(s))` : ''}`;
};
const commandId = (command) => createHash('sha256').update(command).digest('hex').slice(0, 8);

/**
 * Codex hooks written in .codex/config.toml (`[[hooks.<Event>]]` groups with `[[hooks.<Event>.hooks]]`
 * handlers), rebuilt into the .codex/hooks.json shape so they are compared like it (MA10 a).
 * @returns {{ hooks: object|null, problems: string[] }}
 */
export function tomlHooks(entries) {
  const out = {};
  const problems = new Set();
  const scalar = (entry) => entry.value ?? (entry.raw !== null && /^\d+(?:\.\d+)?$/u.test(entry.raw) ? Number(entry.raw) : entry.raw);
  // An element marker only where the parser put one: a quoted key reading "#0" is a key (J206 review).
  const marker = (entry, at) => ((entry.elements ?? []).includes(at) ? Number(entry.path[at].slice(1)) : undefined);
  for (const entry of entries.values()) {
    const [head, event, , field, , key] = entry.path;
    if (head !== 'hooks') continue;
    if (event === undefined) {
      if (entry.kind === 'value') problems.add('.codex/config.toml: hooks is a value, not [[hooks.<Event>]] tables');
      continue;
    }
    const group = marker(entry, 2);
    if (group === undefined) {
      problems.add(`.codex/config.toml: hooks.${event} is not written as [[hooks.${event}]] tables, so it can't be compared`);
      continue;
    }
    const at = ((out[event] ??= [])[group] ??= { hooks: [] });
    if (entry.path.length === 3) continue;
    if (field !== 'hooks') {
      if (entry.path.length === 4) at[field] = scalar(entry);
      continue;
    }
    const slot = marker(entry, 4);
    if (slot === undefined) {
      problems.add(`.codex/config.toml: hooks.${event} lists its handlers inline; write them as [[hooks.${event}.hooks]] tables to be compared`);
      continue;
    }
    const target = (at.hooks[slot] ??= {});
    if (key !== undefined && entry.path.length === 6) target[key] = scalar(entry);
  }
  for (const groups of Object.values(out)) for (const group of groups) if (group) group.hooks = group.hooks.filter(Boolean);
  for (const event of Object.keys(out)) out[event] = out[event].filter(Boolean);
  return { hooks: Object.keys(out).length > 0 ? out : null, problems: [...problems] };
}

function auditHooks(root, toml = { entries: new Map(), error: null }) {
  const claude = readHooks(root, '.claude/settings.json', 'claude');
  const codex = readHooks(root, '.codex/hooks.json', 'codex');
  if (!toml.error) {
    const inline = tomlHooks(toml.entries);
    const fromToml = hookEntries(inline.hooks, 'codex');
    codex.entries.push(...fromToml.entries.map((entry) => ({ ...entry, from: '.codex/config.toml' })));
    codex.problems.push(...inline.problems, ...fromToml.problems.map((problem) => `.codex/config.toml: ${problem}`));
  }
  const items = [...claude.problems, ...codex.problems].map((problem) => item('hooks', problem.split(':')[0], 'broken', { note: problem }));
  const groups = new Map();
  const add = (name, tool, entry) => {
    if (!groups.has(name)) groups.set(name, { claude: [], codex: [] });
    groups.get(name)[tool].push(entry);
  };
  for (const [tool, { entries }] of [['claude', claude], ['codex', codex]]) {
    for (const entry of entries) {
      if (entry.type !== 'command') add(`${entry.event} ${entry.type} handler (${tool})`, tool, entry);
      else if (entry.script) add(`${entry.event} ${basename(entry.script)}`, tool, entry);
      else add(`${entry.event} inline:${commandId(entry.command)}`, tool, entry);
    }
  }
  for (const [name, sides] of [...groups.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    const all = [...sides.claude.map((entry) => ['claude', entry]), ...sides.codex.map((entry) => ['codex', entry])];
    const scripts = [...new Set(all.map(([, entry]) => entry.script).filter(Boolean))];
    const base = {
      claude: sides.claude.length ? sides.claude.map(describe).join(' ; ') : null,
      codex: sides.codex.length ? sides.codex.map(describe).join(' ; ') : null,
      scripts,
    };
    const push = (status, note) => items.push(item('hooks', name, status, { ...base, note }));
    const unknown = all.filter(([tool, entry]) => !EVENTS[tool].has(entry.event));
    if (unknown.length) {
      push('broken', unknown.map(([tool, entry]) => `${TOOLS[tool]} has no ${entry.event} event`).join('; '));
      continue;
    }
    const handler = all.find(([, entry]) => entry.type !== 'command');
    if (handler) {
      const [tool, entry] = handler;
      push(entry.type === 'invalid' ? 'broken' : `${tool}-only`, entry.type === 'invalid' ? 'a hook without a command or type' : `a ${entry.type} handler runs only in ${TOOLS[tool]}; use a command hook on a shared script`);
      continue;
    }
    const inline = all.find(([, entry]) => !entry.script);
    if (inline) {
      push('inline', `${inline[1].why}; put the command in a shared script both configs call`);
      continue;
    }
    if (sides.codex.some((entry) => entry.usesClaudeRoot)) {
      push('broken', 'the Codex entry uses $CLAUDE_PROJECT_DIR, which Codex never sets; use $(git rev-parse --show-toplevel)');
      continue;
    }
    const missing = scripts.filter((script) => !isFile(join(root, script)));
    if (missing.length) {
      push('broken', `script not found: ${missing.join(', ')}`);
      continue;
    }
    if (!sides.claude.length || !sides.codex.length) {
      const [tool, entry] = all[0];
      const other = tool === 'claude' ? 'codex' : 'claude';
      push(`${tool}-only`, EVENTS[other].has(entry.event) ? `no ${other === 'codex' ? '.codex/hooks.json' : '.claude/settings.json'} entry` : `${TOOLS[other]} has no ${entry.event} event`);
      continue;
    }
    // Both tools register it. Compare every registration: matcher, real script, arguments (as multisets, so
    // a duplicate registration on one side is drift).
    const signature = (entry) => JSON.stringify([entry.matcher, entry.runner, real(join(root, entry.script)), entry.args]);
    const reals = (entries) => [...new Set(entries.map((entry) => real(join(root, entry.script))))].sort();
    const [ra, rb] = [reals(sides.claude), reals(sides.codex)];
    if (ra.join('\0') === rb.join('\0')) {
      const [sa, sb] = [sides.claude.map(signature).sort(), sides.codex.map(signature).sort()];
      if (sa.join('\0') === sb.join('\0')) push('same', ra.length === 1 && new Set(scripts).size > 1 ? 'two paths, one real script' : 'one script, both configs');
      else {
        const shape = (entries) => entries.map((entry) => `${entry.matcher}${entry.args.length ? ` +${entry.args.length} arg(s)` : ''}`).join(', ');
        push('drift', `registrations differ (matcher, interpreter, arguments or count): Claude [${shape(sides.claude)}] vs Codex [${shape(sides.codex)}]`);
      }
      continue;
    }
    if (ra.length === 1 && rb.length === 1) {
      const [x, y] = [tryHash(ra[0]), tryHash(rb[0])];
      if (x.error || y.error) push('broken', x.error ?? y.error);
      else push(x.hash === y.hash ? 'copy' : 'drift', `two scripts: ${scripts.join(', ')}`);
      continue;
    }
    push('drift', `several scripts named ${name.split(' ')[1]}: ${scripts.join(', ')}`);
  }
  return items;
}

/** MA9's literal-token grammar (scripts/agent-policy.mjs): what both tools read the same way. */
const POLICY_TOKEN = /^[A-Za-z0-9._/@%+=,-]+$/u;

/**
 * Claude's Bash denies as token lists (MA9's mapping): `Bash(<tokens>:*)` with plain tokens. Any other
 * Bash deny (a wildcard, an exact command) has no one Codex prefix rule and is counted as unsupported;
 * non-Bash denies (Read, Edit…) are no command rule at all.
 * @returns {{ prefixes: Set<string>, unsupported: number }} prefixes as JSON token lists
 */
export function claudeDenyPrefixes(deny) {
  const prefixes = new Set();
  let unsupported = 0;
  for (const entry of Array.isArray(deny) ? deny : []) {
    if (typeof entry !== 'string' || !/^Bash\(/u.test(entry)) continue;
    const tokens = /^Bash\(([^():]+):\*\)$/u.exec(entry)?.[1]?.split(' ');
    if (tokens && tokens.every((token) => POLICY_TOKEN.test(token))) prefixes.add(JSON.stringify(tokens));
    else unsupported++;
  }
  return { prefixes, unsupported };
}

/**
 * Codex execpolicy calls in a rules file, read as Starlark source: comments and strings are skipped
 * when finding `prefix_rule(`, keyword arguments may come in any order. Each call's arguments, or null
 * when one isn't a double-quoted string, a list of them, or a nested list (alternatives).
 */
function starlarkCalls(text, name) {
  const calls = [];
  let i = 0;
  const skipString = () => {
    const quote = text[i];
    for (i++; i < text.length && text[i] !== quote; i++) if (text[i] === '\\') i++;
    i++;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") { skipString(); continue; }
    if (text.startsWith(`${name}(`, i) && !/[A-Za-z0-9_]/u.test(text[i - 1] ?? '')) {
      i += name.length + 1;
      const begin = i;
      let depth = 1;
      while (i < text.length && depth > 0) {
        if (text[i] === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
        if (text[i] === '"' || text[i] === "'") { skipString(); continue; }
        if ('([{'.includes(text[i])) depth++;
        if (')]}'.includes(text[i])) depth--;
        i++;
      }
      calls.push(text.slice(begin, i - 1).replace(/#[^\n]*/gu, ''));
      continue;
    }
    i++;
  }
  return calls.map((body) => {
    const args = {};
    for (const part of body.split(/,(?=\s*[A-Za-z_]+\s*=)/u)) {
      const kw = /^\s*([A-Za-z_]+)\s*=\s*([\s\S]*?)\s*,?\s*$/u.exec(part);
      if (!kw) return null;
      try {
        args[kw[1]] = JSON.parse(kw[2]);
      } catch {
        return null;
      }
    }
    return args;
  });
}

/**
 * The command prefixes Codex forbids in `.codex/rules/*.rules`: each `prefix_rule(pattern=[…],
 * decision="forbidden")` with MA9's plain tokens. Alternatives, other syntax and unreadable files are
 * counted, never dropped.
 * @returns {{ prefixes: Set<string>, unsupported: number }} prefixes as JSON token lists
 */
export function codexForbiddenPrefixes(texts) {
  const prefixes = new Set();
  let unsupported = 0;
  for (const text of texts) {
    for (const args of starlarkCalls(text ?? '', 'prefix_rule')) {
      if (args === null) { unsupported++; continue; }
      if (args.decision !== 'forbidden') continue;
      const tokens = args.pattern;
      if (Array.isArray(tokens) && tokens.length > 0 && tokens.every((token) => typeof token === 'string' && POLICY_TOKEN.test(token))) prefixes.add(JSON.stringify(tokens));
      else unsupported++;
    }
  }
  return { prefixes, unsupported };
}

/** Claude `permissions.deny` against Codex's forbidden rules: the same prefixes, or drift with counts (never the rules' text). */
function comparePermissions(root, settings) {
  const claude = claudeDenyPrefixes(settings.permissions?.deny);
  const rulesDir = join(root, '.codex/rules');
  const reads = list(rulesDir).filter((name) => name.endsWith('.rules')).map((name) => ({ name, ...readText(join(rulesDir, name)) }));
  const unreadable = reads.filter((file) => file.error);
  if (unreadable.length > 0) return { status: 'broken', note: `unreadable .codex/rules file(s): ${unreadable.map((file) => file.name).join(', ')}` };
  const codex = codexForbiddenPrefixes(reads.map((file) => file.text));
  if (claude.prefixes.size === 0 && claude.unsupported === 0 && codex.prefixes.size === 0 && codex.unsupported === 0) return null;
  const onlyClaude = [...claude.prefixes].filter((prefix) => !codex.prefixes.has(prefix)).length + claude.unsupported;
  const onlyCodex = [...codex.prefixes].filter((prefix) => !claude.prefixes.has(prefix)).length + codex.unsupported;
  if (onlyClaude === 0 && onlyCodex === 0) return { status: 'paired', note: `the same ${claude.prefixes.size} refused command prefix(es) in permissions.deny and .codex/rules` };
  return { status: 'drift', note: `refused command prefixes differ: ${onlyClaude} only in Claude permissions.deny, ${onlyCodex} only in .codex/rules (one spec writes both: scripts/agent-policy.mjs)` };
}

/** Claude `env` against Codex `shell_environment_policy.set`: same names and string values, or drift naming keys only. */
function compareEnv(settings, toml) {
  const claude = isObject(settings.env) ? settings.env : {};
  const codex = new Map([...toml.entries.values()].filter((entry) => entry.path[0] === 'shell_environment_policy' && entry.path[1] === 'set' && entry.path.length === 3).map((entry) => [entry.path[2], entry]));
  const names = [...new Set([...Object.keys(claude), ...codex.keys()])].sort();
  if (names.length === 0) return null;
  const differ = names.filter((name) => {
    const theirs = codex.get(name);
    return !Object.hasOwn(claude, name) || typeof claude[name] !== 'string' || !theirs || theirs.raw !== null || theirs.value !== claude[name];
  });
  return differ.length === 0
    ? { status: 'paired', note: `the same ${names.length} variable(s) in env and shell_environment_policy.set` }
    : { status: 'drift', note: `env and shell_environment_policy.set differ for: ${differ.join(', ')}` };
}

function auditSettings(root, toml) {
  const items = [];
  const settingsRead = readText(join(root, '.claude/settings.json'));
  const settingsParsed = parseJson(settingsRead.text);
  const settings = isObject(settingsParsed.value) ? settingsParsed.value : {};
  const mcpRead = readText(join(root, '.mcp.json'));
  const mcpParsed = parseJson(mcpRead.text);
  if (mcpRead.error || mcpParsed.error) items.push(item('mcp', '.mcp.json', 'broken', { note: mcpRead.error ?? `.mcp.json does not parse: ${mcpParsed.error}` }));
  else if (mcpRead.text !== null && !isObject(mcpParsed.value?.mcpServers)) items.push(item('mcp', '.mcp.json', 'broken', { note: '.mcp.json must be an object with an "mcpServers" object' }));
  if (toml.error) items.push(item('settings', '.codex/config.toml', 'broken', { note: toml.error }));
  const codexKeys = new Set(toml.error ? [] : [...toml.entries.values()].map((entry) => entry.path[0]));
  if (list(join(root, '.codex/rules')).some((name) => name.endsWith('.rules'))) codexKeys.add('rules');
  // Hooks in config.toml are compared with the other hooks (auditHooks, MA10 a).
  const claimed = new Set(['hooks', 'mcp_servers']); // their own kinds
  for (const key of Object.keys(settings).filter((name) => !['hooks', '$schema', 'mcpServers'].includes(name))) {
    const counterparts = (SETTING_MAP[key] ?? []).filter((codexKey) => codexKeys.has(codexKey));
    counterparts.forEach((codexKey) => claimed.add(codexKey));
    // MA10 (c): where both sides carry the same meaning in a comparable form, compare it.
    const meaning = toml.error ? null : key === 'permissions' ? comparePermissions(root, settings) : key === 'env' ? compareEnv(settings, toml) : null;
    if (meaning) ['rules', 'shell_environment_policy'].forEach((codexKey) => codexKeys.has(codexKey) && SETTING_MAP[key].includes(codexKey) && claimed.add(codexKey));
    items.push(item('settings', key, meaning?.status ?? (counterparts.length ? 'paired' : 'claude-only'), {
      claude: `.claude/settings.json ${key}`,
      codex: counterparts.length ? `.codex/config.toml ${counterparts.join(', ')}` : null,
      note: meaning?.note ?? (counterparts.length ? 'different formats; not compared' : SETTING_MAP[key] ? `Codex counterpart: ${SETTING_MAP[key].join(' / ')}` : 'no Codex counterpart'),
    }));
  }
  for (const key of [...codexKeys].filter((codexKey) => !claimed.has(codexKey)).sort()) {
    const claudeKey = Object.entries(SETTING_MAP).find(([, values]) => values.includes(key))?.[0];
    items.push(item('settings', key, 'codex-only', { codex: `.codex/config.toml ${key}`, note: claudeKey ? `Claude counterpart: ${claudeKey}` : 'no Claude counterpart' }));
  }
  const claudeMcp = new Set(isObject(mcpParsed.value?.mcpServers) ? Object.keys(mcpParsed.value.mcpServers) : []);
  const codexMcp = new Set(toml.error ? [] : [...toml.entries.values()].filter((entry) => entry.path[0] === 'mcp_servers' && entry.path.length > 1).map((entry) => entry.path[1]));
  for (const name of [...new Set([...claudeMcp, ...codexMcp])].sort()) {
    const both = claudeMcp.has(name) && codexMcp.has(name);
    items.push(item('mcp', name, both ? 'paired' : claudeMcp.has(name) ? 'claude-only' : 'codex-only', {
      claude: claudeMcp.has(name) ? '.mcp.json' : null,
      codex: codexMcp.has(name) ? '.codex/config.toml' : null,
      note: both ? 'different formats; not compared' : '',
    }));
  }
  return items;
}

/** Claude subagents are `.claude/agents/*.md` with name and description; Codex roles are `.codex/agents/*.toml` with developer_instructions. */
function auditCommandsAndAgents(root) {
  const items = [];
  for (const name of list(join(root, '.claude/commands')).filter((file) => file.endsWith('.md'))) {
    items.push(item('commands', name, 'claude-only', { claude: `.claude/commands/${name}`, note: 'Codex loads no repo prompts; make it a skill' }));
  }
  const claudeAgents = new Map();
  for (const file of list(join(root, '.claude/agents'))) {
    const path = join(root, '.claude/agents', file);
    if (!isFile(path)) continue;
    if (!file.endsWith('.md')) {
      items.push(item('agents', file, 'broken', { claude: `.claude/agents/${file}`, note: 'Claude Code loads only .md subagents' }));
      continue;
    }
    const { text, error } = readText(path);
    const { fields, error: parseError } = parseFrontmatter(text);
    const problem = error ?? (parseError ? `frontmatter: ${parseError}` : !nonEmpty(fields.name) || !nonEmpty(fields.description) ? 'frontmatter needs a nonempty name and description' : null);
    claudeAgents.set(file.replace(/\.md$/, ''), { file, problem });
  }
  const codexAgents = new Map();
  for (const file of list(join(root, '.codex/agents'))) {
    const path = join(root, '.codex/agents', file);
    if (!isFile(path)) continue;
    if (!file.endsWith('.toml')) {
      items.push(item('agents', file, 'broken', { codex: `.codex/agents/${file}`, note: 'Codex loads only .toml agent roles' }));
      continue;
    }
    const { text, error } = readText(path);
    const parsed = parseToml(text);
    const problem = error ?? (parsed.error ? `does not parse: ${parsed.error}` : !nonEmpty(tomlValue(parsed.entries, 'developer_instructions')) ? 'Codex needs a nonempty developer_instructions' : null);
    codexAgents.set(file.replace(/\.toml$/, ''), { file, problem });
  }
  for (const name of [...new Set([...claudeAgents.keys(), ...codexAgents.keys()])].sort()) {
    const a = claudeAgents.get(name);
    const b = codexAgents.get(name);
    const problems = [a?.problem && `.claude/agents/${a.file}: ${a.problem}`, b?.problem && `.codex/agents/${b.file}: ${b.problem}`].filter(Boolean);
    items.push(item('agents', name, problems.length ? 'broken' : a && b ? 'paired' : a ? 'claude-only' : 'codex-only', {
      claude: a ? `.claude/agents/${a.file}` : null,
      codex: b ? `.codex/agents/${b.file}` : null,
      note: problems.join('; ') || (a && b ? 'different formats; not compared' : ''),
    }));
  }
  return items;
}

function auditGitHooks(root) {
  const hooksDir = join(root, '.githooks');
  if (!isDir(hooksDir)) return [];
  const base = { claude: '.githooks', codex: '.githooks' };
  // A Git checkout of its own: the hooks must be active, not just intended. A directory nested in another
  // checkout (or no Git at all) has only package.json's intent to go on.
  const own = real(run(['rev-parse', '--show-toplevel'], root) || '/nonexistent') === real(root);
  if (own) {
    const configured = run(['config', '--get', 'core.hooksPath'], root);
    const active = configured !== '' && real(isAbsolute(configured) ? configured : join(root, configured)) === real(hooksDir);
    return [item('githooks', '.githooks', active ? 'shared' : 'broken', {
      ...base,
      note: active ? 'Git runs them for both tools' : `core.hooksPath is ${configured ? JSON.stringify(configured) : 'unset'}, not .githooks; run pnpm install or git config core.hooksPath .githooks`,
    })];
  }
  return [item('githooks', '.githooks', 'broken', { ...base, note: 'not a Git checkout of its own, so no core.hooksPath runs these hooks' })];
}

// ---------------------------------------------------------------- kit drift (MA4)

/** The files repo-kit stamps into every repo besides its skills and hook scripts (scripts/agent-sync.mjs --from). */
export const KIT_SCRIPTS = ['.agents/hooks.json', 'scripts/agent-parity.mjs', 'scripts/agent-sync.mjs'];
/** Where the kit's hook scripts lived before MA2; a repo not yet stamped still has them there. */
const LEGACY_HOOK_DIR = '.claude/hooks';
const realDirs = (dir) => list(dir).filter((name) => isDir(join(dir, name)) && !isLink(join(dir, name)));
const filesUnder = (root, dir) => {
  const out = [];
  for (const name of list(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (isDir(join(root, path)) && !isLink(join(root, path))) out.push(...filesUnder(root, path));
    else if (isFile(join(root, path))) out.push(path);
  }
  return out;
};

/** The kit's own pieces, as drift units: one per skill directory, one per hook file, one per stamped script. */
export function kitUnits(kit) {
  return [
    ...realDirs(join(kit, '.agents/skills')).map((name) => ({ name: `skills/${name}`, path: `.agents/skills/${name}`, legacy: `.claude/skills/${name}` })),
    ...list(join(kit, '.agents/hooks')).filter((name) => !isLink(join(kit, '.agents/hooks', name))).map((name) => {
      const path = `.agents/hooks/${name}`;
      return { name: `hooks/${name}`, path, legacy: isFile(join(kit, path)) ? `${LEGACY_HOOK_DIR}/${name}` : null };
    }),
    ...KIT_SCRIPTS.filter((path) => isFile(join(kit, path))).map((path) => ({ name: path, path, legacy: null })),
  ];
}

/**
 * Each kit-owned piece of a repo against the kit's bytes (`--kit <repo-kit>`): `same`, `drift` (bytes
 * differ, or the piece is still in the old .claude/ layout), `missing`, and for the repo's own skills and
 * hook scripts `accepted` when `.agents/parity.json` lists them under "owned", else `drift`.
 */
export function auditKit(root, kit, owned = {}) {
  const items = [];
  const units = kitUnits(kit);
  for (const unit of units) {
    const want = tryHash(join(kit, unit.path));
    if (want.error) {
      items.push(item('kit', unit.name, 'broken', { note: `the kit's copy: ${want.error}` }));
      continue;
    }
    const here = existsSync(join(root, unit.path)) ? unit.path : unit.legacy && existsSync(join(root, unit.legacy)) ? unit.legacy : null;
    if (!here) {
      items.push(item('kit', unit.name, 'missing', { note: `no ${unit.path}; stamp it: node scripts/agent-sync.mjs --from <repo-kit>` }));
      continue;
    }
    const have = tryHash(join(root, here));
    if (have.error) items.push(item('kit', unit.name, 'broken', { note: have.error }));
    else if (here !== unit.path) items.push(item('kit', unit.name, 'drift', { note: `old layout at ${here}${have.hash === want.hash ? ' (same bytes)' : ', bytes differ'}; stamp it: node scripts/agent-sync.mjs --from <repo-kit>` }));
    else if (have.hash !== want.hash) items.push(item('kit', unit.name, 'drift', { note: `${unit.path} differs from the kit's; fix it in repo-kit, then stamp` }));
    else items.push(item('kit', unit.name, 'same', { note: 'the kit\'s bytes' }));
  }
  // The generated manifests and links, judged by the kit's own generator against this repo's spec.
  if (isFile(join(root, '.agents/hooks.json')) && isFile(join(kit, 'scripts/agent-sync.mjs'))) {
    const check = spawnSync(process.execPath, [join(kit, 'scripts/agent-sync.mjs'), '--check', '--root', root], { encoding: 'utf8', timeout: 30_000 });
    const why = (check.stderr || '').split('\n').filter(Boolean).map((line) => line.replace(/^agent-sync: /, ''));
    if (check.status === 0) items.push(item('kit', 'generated manifests', 'same', { note: '.claude/settings.json hooks, .codex/hooks.json and .claude/skills links match the spec' }));
    else items.push(item('kit', 'generated manifests', 'drift', { note: `${why.slice(0, 3).join('; ') || 'agent-sync --check failed'}; run node scripts/agent-sync.mjs` }));
  }
  // The repo's own skills and hook scripts: kept on purpose, or drift from a kit that forgot them.
  const kitNames = new Set(units.map((unit) => unit.name));
  const extras = new Set();
  for (const dir of ['.agents/skills', '.claude/skills']) for (const name of list(join(root, dir))) if (isDir(join(root, dir, name))) extras.add(`skills/${name}`);
  for (const name of list(join(root, '.agents/hooks'))) extras.add(`hooks/${name}`);
  for (const name of list(join(root, LEGACY_HOOK_DIR))) if (isFile(join(root, LEGACY_HOOK_DIR, name))) extras.add(`hooks/${name}`);
  for (const name of [...extras].filter((entry) => !kitNames.has(entry)).sort()) {
    const reason = owned[name];
    if (typeof reason === 'string' && reason.trim()) items.push(item('kit', name, 'accepted', { note: `this repo's own: ${reason.trim()}` }));
    else items.push(item('kit', name, 'drift', { note: `not a kit file: list it under "owned" in ${EXCEPTIONS} with a reason, or move it into repo-kit` }));
  }
  for (const name of Object.keys(owned).filter((key) => kitNames.has(key) || !extras.has(key))) {
    items.push(item('exceptions', `owned:${name}`, 'broken', { note: `${EXCEPTIONS} owns ${name}, which ${kitNames.has(name) ? 'is a kit file' : 'this repo does not have'}` }));
  }
  return items;
}

/**
 * Reasons for accepted one-sided items, `{ "accept": { "<kind>:<name>": "<why>" } }`, the repo's own skills
 * and hook scripts for --kit, `{ "owned": { "skills/<name>": "<why>" } }`, and schema problems.
 */
export function readExceptions(root) {
  const { text, error: readError } = readText(join(root, EXCEPTIONS));
  if (readError) return { accept: {}, owned: {}, problems: [readError] };
  const { value, error } = parseJson(text);
  if (error) return { accept: {}, owned: {}, problems: [`${EXCEPTIONS} does not parse: ${error}`] };
  if (text === null) return { accept: {}, owned: {}, problems: [] };
  const shape = isObject(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => (key === 'accept' || key === 'owned') && isObject(value[key]));
  if (!shape) {
    return { accept: {}, owned: {}, problems: [`${EXCEPTIONS} must be { "accept"?: { "<kind>:<name>": "<reason>" }, "owned"?: { "skills/<name>" or "hooks/<name>": "<reason>" } }`] };
  }
  const out = { accept: {}, owned: {}, problems: [] };
  for (const key of ['accept', 'owned']) {
    for (const [id, reason] of Object.entries(value[key] ?? {})) {
      if (typeof reason !== 'string') out.problems.push(`${EXCEPTIONS} reason for ${id} is not a string`);
      else out[key][id] = reason;
    }
  }
  return out;
}

/**
 * Every agent-tooling item in a repo, with its status. Never throws for repo content. With `kit` (a
 * repo-kit checkout), also each kit-owned piece against the kit's bytes (MA4).
 */
export function audit(rootDir, { kit = null } = {}) {
  const root = resolve(rootDir);
  const tomlRead = readText(join(root, '.codex/config.toml'));
  const toml = tomlRead.error ? { entries: new Map(), error: tomlRead.error } : tomlRead.text === null ? { entries: new Map(), error: null } : parseToml(tomlRead.text);
  const docRaw = toml.entries.get('project_doc_max_bytes')?.raw;
  const docBytes = docRaw && /^\d[\d_]*$/.test(docRaw) ? Number(docRaw.replace(/_/g, '')) : NaN;
  const docLimit = docBytes > 0 ? { bytes: docBytes, source: 'this repo\'s project_doc_max_bytes' } : { bytes: CODEX_DOC_BYTES, source: 'Codex\'s default project_doc_max_bytes' };
  const items = [];
  for (const [kind, step] of [
    ['rules', () => auditRules(root, docLimit)],
    ['skills', () => auditSkills(root)],
    ['hooks', () => auditHooks(root, toml)],
    ['settings', () => auditSettings(root, toml)],
    ['agents', () => auditCommandsAndAgents(root)],
    ['githooks', () => auditGitHooks(root)],
  ]) {
    try {
      items.push(...step());
    } catch (error) {
      items.push(item(kind, 'audit', 'broken', { note: `could not audit: ${error.code ?? ''} ${error.message}`.trim() }));
    }
  }
  const { accept, owned, problems } = readExceptions(root);
  for (const problem of problems) items.push(item('exceptions', EXCEPTIONS, 'broken', { note: problem }));
  if (kit) {
    try {
      items.push(...auditKit(root, resolve(kit), owned));
    } catch (error) {
      items.push(item('kit', 'audit', 'broken', { note: `could not compare with the kit: ${error.code ?? ''} ${error.message}`.trim() }));
    }
  }
  const used = new Set();
  for (const entry of items) {
    const id = `${entry.kind}:${entry.name}`;
    const reason = accept[id];
    if (typeof reason === 'string' && reason.trim() && ONE_SIDED.has(entry.status)) {
      entry.note = `${entry.status}, accepted: ${reason.trim()}`;
      entry.status = 'accepted';
      used.add(id);
    }
  }
  for (const id of Object.keys(accept).filter((key) => !used.has(key))) {
    const why = accept[id].trim() ? 'accepts an item that is not one-sided here (stale, or not acceptable: only claude-only/codex-only can be)' : 'gives an empty reason';
    items.push(item('exceptions', id, 'broken', { note: `${EXCEPTIONS} ${why}` }));
  }
  return items;
}

export const refusals = (items) => items.filter((entry) => !PASSING.has(entry.status));

export function summarize(items) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const entry of items) counts[entry.status] += 1;
  return counts;
}

export function format(items, root) {
  const lines = [`agent parity: ${root}`];
  for (const entry of items) {
    const where = entry.scripts.length ? ` [${entry.scripts.join(', ')}]` : '';
    lines.push(`  ${entry.status.padEnd(11)} ${entry.kind.padEnd(8)} ${entry.name}${where}${entry.note ? ` — ${entry.note}` : ''}`);
  }
  const counts = summarize(items);
  lines.push(`  ${STATUSES.filter((status) => counts[status]).map((status) => `${status} ${counts[status]}`).join(', ') || 'no agent tooling found'}`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let root = null;
  let json = false;
  let strict = false;
  let kit = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--strict') strict = true;
    else if (args[i] === '--root' && args[i + 1]) root = args[++i];
    else if (args[i] === '--kit' && args[i + 1]) kit = args[++i];
    else {
      console.error('usage: agent-parity.mjs [--root <dir>] [--kit <repo-kit>] [--json] [--strict]');
      process.exit(2);
    }
  }
  root ??= run(['rev-parse', '--show-toplevel'], process.cwd()) || process.cwd();
  if (!isDir(root)) {
    console.error(`agent-parity: no such directory: ${root}`);
    process.exit(2);
  }
  if (kit !== null && !isDir(kit)) {
    console.error(`agent-parity: no such directory: ${kit}`);
    process.exit(2);
  }
  const items = audit(root, { kit });
  const refused = refusals(items);
  if (json) console.log(JSON.stringify({ root: resolve(root), counts: summarize(items), items }, null, 2));
  else console.log(format(items, resolve(root)));
  if (strict && refused.length) {
    console.error(`agent parity: ${refused.length} item(s) refused (--strict). Fix the layout or accept a one-sided item in ${EXCEPTIONS} with a reason.`);
    process.exit(1);
  }
  process.exit(0);
}
