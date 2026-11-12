#!/usr/bin/env node
// Agent tooling from one source: write what Claude Code and Codex CLI
// each load from the repo's single spec (meta
// docs/plans/MULTI-AGENT-TOOLING-PLAN.md, MA2 and MA3).
//
//   node scripts/agent-sync.mjs [--root <dir>]          write it
//   node scripts/agent-sync.mjs --check [--root <dir>]  exit 1 if stale or invalid
//   node scripts/agent-sync.mjs --from <repo-kit> [--root <dir>]
//                                    stamp the kit's agent layout, then write
//
// The source, edited by hand:
//   .agents/hooks.json        kit-owned hook spec: [{ event, tools?, script,
//                             args?, status?, timeout? }]; tools is "shell"
//                             (Claude and Codex Bash) or "edit" (Claude
//                             Edit|Write|MultiEdit, Codex apply_patch)
//   .agents/hooks.local.json  optional, the repo's own hooks, same shape
//   .agents/hooks/            the scripts both tools run (lib/payload.mjs
//                             reads either tool's stdin)
//   .agents/skills/<name>/    one directory per skill (Codex reads here)
// What this writes, never edited by hand:
//   .claude/settings.json     its "hooks" key; other keys are kept
//   .codex/hooks.json         all of it
//   .claude/skills/<name>     a relative symlink to ../../.agents/skills/<name>
//
// Claude's command spells the root $CLAUDE_PROJECT_DIR, which stays put
// when an agent cd's elsewhere; Codex sets no such variable, so its
// command asks git. The scripts themselves find the root with git.
//
// --from stamps a repo from the kit (MA3): it copies the kit-owned files
// (kitFiles below), removes the old .claude/hooks copies and the old
// .claude/skills directories of kit skills, moves the repo's own
// .claude/skills directories into .agents/skills, then writes. It
// refuses a repo with uncommitted changes in those paths, or whose
// .claude/settings.json runs hooks the spec doesn't name: git keeps
// every replaced byte, and nothing outside these paths is touched.
// Exit 0 ok, 1 stale, invalid or refused, 2 usage.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVENTS, KIT_SCRIPTS, invocation, normalizeMatcher } from './agent-parity.mjs';

export const SPEC = '.agents/hooks.json';
export const LOCAL_SPEC = '.agents/hooks.local.json';
export const CLAUDE_SETTINGS = '.claude/settings.json';
export const CODEX_HOOKS = '.codex/hooks.json';
export const SKILLS = '.agents/skills';
export const CLAUDE_SKILLS = '.claude/skills';
/** What a spec's `tools` becomes in each tool's matcher (recorded payloads: .agents/hooks/test/fixtures/). */
export const MATCHERS = {
  shell: { claude: 'Bash', codex: 'Bash' },
  edit: { claude: 'Edit|Write|MultiEdit', codex: 'apply_patch' },
};
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const RUNNERS = { '.sh': 'bash', '.mjs': 'node', '.js': 'node', '.py': 'python3' };
const ROOTS = { claude: '"$CLAUDE_PROJECT_DIR/', codex: '"$(git rev-parse --show-toplevel)/' };
const SPEC_KEYS = new Set(['event', 'tools', 'script', 'args', 'status', 'timeout']);
/** The command-handler fields each tool accepts, with their types (Claude Code's settings docs; Codex 0.167.1's HookHandlerConfig::Command). */
const positiveInt = (value) => Number.isInteger(value) && value > 0;
const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const HANDLER_FIELDS = {
  claude: { type: (value) => value === 'command', command: nonEmptyString, timeout: positiveInt, statusMessage: nonEmptyString },
  codex: { type: (value) => value === 'command', command: nonEmptyString, commandWindows: nonEmptyString, timeout: positiveInt, async: (value) => typeof value === 'boolean', statusMessage: nonEmptyString, additionalContextLimit: positiveInt },
};
/** The kit's own hook scripts before MA2, removed by --from. */
const LEGACY_HOOKS = ['session-brief.sh', 'guard-git-add.sh', 'md-prose-width.sh', 'herdr-peers.sh', 'guard-herdr-prompt.sh'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const lexists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};
const isLink = (path) => lexists(path) && lstatSync(path).isSymbolicLink();
const isRealDir = (path) => lexists(path) && lstatSync(path).isDirectory();
const isFile = (path) => lexists(path) && lstatSync(path).isFile();
const readMaybe = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// ---------------------------------------------------------------- the spec

/** Read one spec file: its entries and every problem, never a throw. */
function readSpec(root, path, required) {
  const text = readMaybe(join(root, path));
  if (text === null) return { entries: [], problems: required ? [`${path} is missing`] : [] };
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { entries: [], problems: [`${path} does not parse: ${error.message}`] };
  }
  if (!isObject(value) || !Array.isArray(value.hooks) || Object.keys(value).some((key) => key !== 'hooks')) {
    return { entries: [], problems: [`${path} must be { "hooks": [ ... ] }`] };
  }
  const problems = [];
  value.hooks.forEach((entry, index) => {
    const at = `${path} hooks[${index}]`;
    if (!isObject(entry)) {
      problems.push(`${at} is not an object`);
      return;
    }
    for (const key of Object.keys(entry)) if (!SPEC_KEYS.has(key)) problems.push(`${at} has an unknown key "${key}"`);
    const { event, tools, script, args = [], status, timeout } = entry;
    if (!EVENTS.claude.has(event) || !EVENTS.codex.has(event)) problems.push(`${at} event ${JSON.stringify(event)} is not one both tools fire`);
    if (TOOL_EVENTS.has(event) && !Object.hasOwn(MATCHERS, tools)) problems.push(`${at} needs "tools": "shell" or "edit"`);
    if (!TOOL_EVENTS.has(event) && tools !== undefined) problems.push(`${at} ${event} takes no "tools"`);
    if (typeof script !== 'string' || isAbsolute(script) || script.split('/').includes('..') || !/^(?:\.agents\/hooks|scripts)\/[\w./-]+$/.test(script)) {
      problems.push(`${at} script must be a path under .agents/hooks/ or scripts/`);
    } else if (!RUNNERS[script.slice(script.lastIndexOf('.'))]) {
      problems.push(`${at} script must end in ${Object.keys(RUNNERS).join(', ')}`);
    } else if (!existsSync(join(root, script)) || !statSync(join(root, script)).isFile()) {
      problems.push(`${at} script not found: ${script}`);
    }
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || !/^[\w.,=:@%+/-]+$/.test(arg))) problems.push(`${at} args must be plain words (no shell syntax)`);
    if (status !== undefined && (typeof status !== 'string' || status.length > 80 || status.trim() === '')) problems.push(`${at} status must be a short string`);
    if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1 || timeout > 600)) problems.push(`${at} timeout must be 1 to 600 seconds`);
  });
  return { entries: problems.length ? [] : value.hooks, problems };
}

/** The kit spec and the repo's own, as one list. */
export function loadSpec(root) {
  const kit = readSpec(root, SPEC, true);
  const local = readSpec(root, LOCAL_SPEC, false);
  return { entries: [...kit.entries, ...local.entries], problems: [...kit.problems, ...local.problems] };
}

/** One tool's "hooks" object from spec entries. */
export function renderHooks(entries, tool) {
  const hooks = {};
  for (const { event, tools, script, args = [], status, timeout } of entries) {
    const runner = RUNNERS[script.slice(script.lastIndexOf('.'))];
    const handler = { type: 'command', command: [runner, `${ROOTS[tool]}${script}"`, ...args].join(' ') };
    if (timeout !== undefined) handler.timeout = timeout;
    if (tool === 'codex' && status !== undefined) handler.statusMessage = status;
    const matcher = tools === undefined ? undefined : MATCHERS[tools][tool];
    hooks[event] ??= [];
    let group = hooks[event].find((candidate) => candidate.matcher === matcher);
    if (!group) {
      group = matcher === undefined ? { hooks: [] } : { matcher, hooks: [] };
      hooks[event].push(group);
    }
    group.hooks.push(handler);
  }
  return hooks;
}

/** Problems with a hooks object as either tool would load it: event names, group and handler keys. */
export function hookShapeProblems(hooks, tool, path) {
  if (hooks === undefined) return [];
  if (!isObject(hooks)) return [`${path}: "hooks" is not an object`];
  const problems = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!EVENTS[tool].has(event)) problems.push(`${path}: ${event} is not a ${tool === 'claude' ? 'Claude Code' : 'Codex'} hook event`);
    if (!Array.isArray(groups)) {
      problems.push(`${path}: ${event} is not a list`);
      continue;
    }
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks) || Object.keys(group).some((key) => key !== 'matcher' && key !== 'hooks') || (group.matcher !== undefined && typeof group.matcher !== 'string')) {
        problems.push(`${path}: ${event} has a group that is not { matcher?, hooks: [...] }`);
        continue;
      }
      for (const handler of group.hooks) {
        const fields = HANDLER_FIELDS[tool];
        if (!isObject(handler) || handler.type !== 'command' || !nonEmptyString(handler.command)) {
          problems.push(`${path}: ${event} has a handler that is not { type: "command", command: "<text>" }`);
          continue;
        }
        for (const [key, value] of Object.entries(handler)) {
          if (!Object.hasOwn(fields, key)) problems.push(`${path}: ${event} handler has a key ${tool === 'claude' ? 'Claude Code' : 'Codex'} doesn't take: "${key}"`);
          else if (!fields[key](value)) problems.push(`${path}: ${event} handler "${key}" has the wrong type`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- the plan

/**
 * Every file and link the spec implies, against what is on disk.
 * @returns {{ actions: { path: string, kind: 'write'|'link'|'unlink', want?: string }[], problems: string[] }}
 */
export function plan(root) {
  const { entries, problems } = loadSpec(root);
  const actions = [];
  // Hooks: nothing is written from an invalid spec.
  if (!problems.length) {
    const settingsText = readMaybe(join(root, CLAUDE_SETTINGS));
    let settings = {};
    if (settingsText !== null) {
      try {
        settings = JSON.parse(settingsText);
      } catch (error) {
        problems.push(`${CLAUDE_SETTINGS} does not parse: ${error.message}`);
      }
      if (!isObject(settings)) problems.push(`${CLAUDE_SETTINGS} is not a JSON object`);
    }
    if (!problems.length) {
      const claude = renderHooks(entries, 'claude');
      const codex = renderHooks(entries, 'codex');
      problems.push(...hookShapeProblems(claude, 'claude', CLAUDE_SETTINGS), ...hookShapeProblems(codex, 'codex', CODEX_HOOKS));
      const next = { ...settings, hooks: claude };
      if (!Object.keys(claude).length) delete next.hooks;
      const wantSettings = json(next);
      if (settingsText !== wantSettings) actions.push({ path: CLAUDE_SETTINGS, kind: 'write', want: wantSettings });
      const wantCodex = json({ hooks: codex });
      if (readMaybe(join(root, CODEX_HOOKS)) !== wantCodex) actions.push({ path: CODEX_HOOKS, kind: 'write', want: wantCodex });
    }
  }
  // Skills: each .agents/skills/<name> gets a .claude/skills/<name> link.
  const skillsDir = join(root, SKILLS);
  const names = existsSync(skillsDir) ? readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, 'SKILL.md'))).sort() : [];
  for (const name of names) {
    const path = `${CLAUDE_SKILLS}/${name}`;
    const want = `../../${SKILLS}/${name}`;
    if (isLink(join(root, path))) {
      if (readlinkSync(join(root, path)) !== want) actions.push({ path, kind: 'link', want });
    } else if (lexists(join(root, path))) {
      problems.push(`${path} is a real directory beside ${SKILLS}/${name}: keep one (agent-sync --from moves it)`);
    } else actions.push({ path, kind: 'link', want });
  }
  // A link into .agents/skills whose skill is gone.
  const claudeSkills = join(root, CLAUDE_SKILLS);
  for (const name of existsSync(claudeSkills) || isLink(claudeSkills) ? readdirSync(claudeSkills).sort() : []) {
    const full = join(claudeSkills, name);
    if (isLink(full) && readlinkSync(full).startsWith(`../../${SKILLS}/`) && !names.includes(name)) actions.push({ path: `${CLAUDE_SKILLS}/${name}`, kind: 'unlink' });
  }
  return { actions, problems };
}

/** Carry out a plan's actions. */
export function apply(root, actions) {
  for (const action of actions) {
    const full = join(root, action.path);
    mkdirSync(dirname(full), { recursive: true });
    if (action.kind === 'write') writeFileSync(full, action.want);
    else {
      if (isLink(full)) unlinkSync(full);
      if (action.kind === 'link') symlinkSync(action.want, full);
    }
  }
}

// ---------------------------------------------------------------- the stamp

/** Every file under a directory, repo-relative, sorted. */
function walk(root, dir) {
  const out = [];
  const full = join(root, dir);
  if (!isRealDir(full)) return out;
  for (const name of readdirSync(full).sort()) {
    const path = `${dir}/${name}`;
    if (isRealDir(join(root, path))) out.push(...walk(root, path));
    else if (lstatSync(join(root, path)).isFile()) out.push(path);
  }
  return out;
}

/** Every non-directory entry under a directory, files and links alike (links never followed), repo-relative, sorted. */
function entriesUnder(root, dir) {
  const out = [];
  if (!isRealDir(join(root, dir))) return out;
  for (const name of readdirSync(join(root, dir)).sort()) {
    const path = `${dir}/${name}`;
    if (isRealDir(join(root, path))) out.push(...entriesUnder(root, path));
    else out.push(path);
  }
  return out;
}

/** The kit-owned files a stamp copies: the hook scripts, the kit spec, the kit's skills and the two scripts. */
export function kitFiles(kit) {
  return [...walk(kit, '.agents/hooks'), ...walk(kit, SKILLS), ...KIT_SCRIPTS].filter((path) => existsSync(join(kit, path))).sort();
}

/** The kit's skill names. */
export const kitSkills = (kit) => (isRealDir(join(kit, SKILLS)) ? readdirSync(join(kit, SKILLS)).filter((name) => isRealDir(join(kit, SKILLS, name))).sort() : []);

const gitOut = (root, args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/** The first symlink at or above `rel` inside root, component by component, or null. */
function linkOnPath(root, rel) {
  const parts = rel.split('/');
  for (let k = 1; k <= parts.length; k++) {
    const sub = parts.slice(0, k).join('/');
    if (isLink(join(root, sub))) return sub;
    if (!lexists(join(root, sub))) return null;
  }
  return null;
}

/** Handler fields that change what a hook does (statusMessage is display only). */
const BEHAVIOUR = ['timeout', 'async', 'commandWindows', 'additionalContextLimit'];

/**
 * Each registration a hooks object makes, comparably: event, matcher (one vocabulary for both tools),
 * runner, script (an old .claude/hooks/<name> reads as .agents/hooks/<name>), arguments and every
 * behaviour field. Unreadable groups count as registrations, so they are never silently dropped.
 */
function registrations(hooks, tool) {
  const out = [];
  if (!isObject(hooks)) return out;
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of Array.isArray(groups) ? groups : [null]) {
      for (const handler of isObject(group) && Array.isArray(group.hooks) ? group.hooks : [null]) {
        const matcher = normalizeMatcher(isObject(group) ? group.matcher : undefined, tool, event);
        const command = isObject(handler) && typeof handler.command === 'string' ? handler.command : null;
        const run = command === null ? null : invocation(command);
        const script = run?.script?.replace(/^\.claude\/hooks\//, '.agents/hooks/') ?? null;
        const type = isObject(handler) ? handler.type ?? 'command' : 'unreadable';
        const fields = BEHAVIOUR.map((key) => (isObject(handler) && handler[key] !== undefined ? [key, handler[key]] : null)).filter(Boolean);
        out.push({
          key: JSON.stringify([event, matcher, type, script, script ? run.runner : command, script ? run.args : [], fields]),
          shown: `${event} ${matcher} ${script ?? (type === 'command' ? 'inline command' : `${type} handler`)}${fields.length ? ` (${fields.map(([key]) => key).join(', ')})` : ''}`,
        });
      }
    }
  }
  return out;
}

/** Registrations in `old` that `fresh` doesn't make (as multisets: a dropped duplicate counts). */
function dropped(old, fresh, tool) {
  const left = new Map();
  for (const { key } of registrations(fresh, tool)) left.set(key, (left.get(key) ?? 0) + 1);
  const out = [];
  for (const { key, shown } of registrations(old, tool)) {
    if (left.get(key)) left.set(key, left.get(key) - 1);
    else out.push(shown);
  }
  return out;
}

function parseManifest(root, path, problems) {
  const text = readMaybe(join(root, path));
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    if (isObject(value)) return value;
  } catch {
    // reported below
  }
  problems.push(`${path} is not a JSON object; fix it first`);
  return null;
}

const realOr = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * Stamp the kit's agent layout into a repo. Everything is checked before anything is written: the kit,
 * the repo's specs and manifests, every registration the new manifests would drop, symlinks on every
 * path it writes or removes, and uncommitted, untracked or ignored files under those paths.
 * @returns {{ changed: string[], replaced: string[], problems: string[] }}
 */
export function stamp(kitDir, rootDir) {
  const kit = resolve(kitDir);
  const root = resolve(rootDir);
  const refuse = (problems) => ({ changed: [], replaced: [], problems });
  if (!isRealDir(kit) || !existsSync(join(kit, SPEC))) return refuse([`${kit} is not a repo-kit checkout (no ${SPEC})`]);
  const top = gitOut(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return refuse([`${root} is not a git checkout`]);
  if (realOr(top.stdout.trim()) !== realOr(root)) return refuse([`${root} is not the top of its checkout`]);
  if (realOr(kit) === realOr(root)) return refuse(['--from names this repo itself']);

  const problems = [];
  const kitSpec = readSpec(kit, SPEC, true);
  problems.push(...kitSpec.problems.map((problem) => `the kit's ${problem}`));
  const files = kitFiles(kit);
  if (!files.length) problems.push(`${kit} has no kit files`);
  const localSpec = readSpec(root, LOCAL_SPEC, false);
  problems.push(...localSpec.problems);
  // The manifests after the stamp must keep every registration the repo has today, in both tools.
  const oldClaude = parseManifest(root, CLAUDE_SETTINGS, problems);
  const oldCodex = parseManifest(root, CODEX_HOOKS, problems);
  if (!kitSpec.problems.length && !localSpec.problems.length) {
    const entries = [...kitSpec.entries, ...localSpec.entries];
    for (const [tool, old, path] of [['claude', oldClaude, CLAUDE_SETTINGS], ['codex', oldCodex, CODEX_HOOKS]]) {
      for (const shown of dropped(old?.hooks, renderHooks(entries, tool), tool)) problems.push(`${path} registers ${shown}, which the spec doesn't: move it into ${LOCAL_SPEC} first`);
    }
  }
  const skills = kitSkills(kit);
  const claudeSkills = join(root, CLAUDE_SKILLS);
  const own = isRealDir(claudeSkills) ? readdirSync(claudeSkills).filter((name) => isRealDir(join(claudeSkills, name)) && !skills.includes(name)).sort() : [];
  for (const name of own) if (lexists(join(root, SKILLS, name))) problems.push(`${CLAUDE_SKILLS}/${name} and ${SKILLS}/${name} both exist: keep one`);
  const oldKitSkills = skills.filter((name) => isRealDir(join(claudeSkills, name)));
  for (const name of oldKitSkills) {
    const dir = `${CLAUDE_SKILLS}/${name}`;
    // Every entry, links included (never followed): a link or a file the kit's skill lacks is the repo's own.
    const extra = entriesUnder(root, dir).filter((path) => isLink(join(root, path)) || !isFile(join(kit, SKILLS, name, relative(dir, path))));
    if (extra.length) problems.push(`${dir} holds files the kit's ${name} doesn't (${extra.join(', ')}): move them out first`);
  }
  // Each skill link the stamp will write: absent, ours already, or a directory it removes or moves.
  const agentSkills = isRealDir(join(root, SKILLS)) ? readdirSync(join(root, SKILLS)) : [];
  const linked = [...new Set([...skills, ...own, ...agentSkills])].sort();
  for (const name of linked) {
    const path = `${CLAUDE_SKILLS}/${name}`;
    const full = join(root, path);
    if (isLink(full) && readlinkSync(full) !== `../../${SKILLS}/${name}`) problems.push(`${path} is a link to ${readlinkSync(full)}, not ../../${SKILLS}/${name}: move it first`);
    else if (lexists(full) && !isLink(full) && !isRealDir(full)) problems.push(`${path} is a file where the stamp writes a skill link: move it first`);
  }
  const stale = isRealDir(claudeSkills) ? readdirSync(claudeSkills).filter((name) => isLink(join(claudeSkills, name)) && !linked.includes(name)).map((name) => `${CLAUDE_SKILLS}/${name}`) : [];
  const legacy = LEGACY_HOOKS.map((name) => `.claude/hooks/${name}`).filter((path) => lexists(join(root, path)));
  // No write or removal may go through a symlink.
  const writes = [...files, CLAUDE_SETTINGS, CODEX_HOOKS, ...own.map((name) => `${SKILLS}/${name}`)];
  const links = linked.map((name) => `${CLAUDE_SKILLS}/${name}`);
  const removes = [...legacy, ...stale, ...oldKitSkills.map((name) => `${CLAUDE_SKILLS}/${name}`), ...own.map((name) => `${CLAUDE_SKILLS}/${name}`)];
  for (const path of [...new Set([...writes, `${CLAUDE_SKILLS}/x`, ...removes.map((entry) => `${dirname(entry)}/x`)])]) {
    const link = linkOnPath(root, path);
    if (link) problems.push(`${link} is a symlink; refusing to write through it`);
  }
  // Nothing uncommitted, untracked or ignored under a path it writes or removes.
  const affected = [...new Set([...writes, ...links, ...removes])];
  const status = gitOut(root, ['-c', 'status.showUntrackedFiles=all', 'status', '--porcelain=v1', '--ignored=matching', '--untracked-files=all', '--', ...affected]);
  if (status.status !== 0) problems.push('git status failed');
  else if (status.stdout.trim()) problems.push(`uncommitted, untracked or ignored files where the stamp writes; commit or clear them first:\n${status.stdout.trimEnd()}`);
  if (problems.length) return refuse(problems);

  const changed = new Set();
  // Copies the stamp replaces whose bytes differ from the kit's: git keeps the old bytes; the caller reviews them.
  const replaced = [];
  for (const path of legacy) {
    const want = join(kit, '.agents/hooks', path.slice('.claude/hooks/'.length));
    if (!existsSync(want) || !readFileSync(join(root, path)).equals(readFileSync(want))) replaced.push(path);
    rmSync(join(root, path));
    changed.add(path);
  }
  if (isRealDir(join(root, '.claude/hooks')) && !readdirSync(join(root, '.claude/hooks')).length) rmdirSync(join(root, '.claude/hooks'));
  for (const name of oldKitSkills) {
    const path = `${CLAUDE_SKILLS}/${name}`;
    for (const file of entriesUnder(root, path)) {
      if (!readFileSync(join(root, file)).equals(readFileSync(join(kit, SKILLS, name, relative(path, file))))) replaced.push(file);
      changed.add(file);
    }
    rmSync(join(root, path), { recursive: true });
  }
  for (const name of own) {
    mkdirSync(join(root, SKILLS), { recursive: true });
    for (const file of entriesUnder(root, `${CLAUDE_SKILLS}/${name}`)) {
      changed.add(file);
      changed.add(`${SKILLS}/${relative(CLAUDE_SKILLS, file)}`);
    }
    renameSync(join(root, CLAUDE_SKILLS, name), join(root, SKILLS, name));
  }
  for (const path of files) {
    const from = join(kit, path);
    const to = join(root, path);
    const bytes = readFileSync(from);
    const mode = statSync(from).mode & 0o777;
    const same = existsSync(to) && readFileSync(to).equals(bytes);
    if (!same || (statSync(to).mode & 0o777) !== mode) {
      if (existsSync(to) && !same) replaced.push(path);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, bytes);
      chmodSync(to, mode);
      changed.add(path);
    }
  }
  const next = plan(root);
  if (next.problems.length) return { changed: [...changed].sort(), replaced, problems: next.problems };
  apply(root, next.actions);
  for (const action of next.actions) changed.add(action.path);
  return { changed: [...changed].sort(), replaced: [...new Set(replaced)].sort(), problems: [] };
}

// ---------------------------------------------------------------- main

function main(argv) {
  let root = process.cwd();
  let check = false;
  let from = null;
  for (let k = 0; k < argv.length; k++) {
    const arg = argv[k];
    if (arg === '--check') check = true;
    else if ((arg === '--root' || arg === '--from') && argv[k + 1] && !argv[k + 1].startsWith('--')) {
      if (arg === '--root') root = argv[++k];
      else from = argv[++k];
    } else {
      process.stderr.write('usage: agent-sync.mjs [--check] [--from <repo-kit>] [--root <dir>]\n');
      return 2;
    }
  }
  if (check && from) {
    process.stderr.write('agent-sync: --check and --from do not mix\n');
    return 2;
  }
  root = resolve(root);
  if (from) {
    const { changed, replaced, problems } = stamp(resolve(from), root);
    for (const path of changed) process.stdout.write(`stamped ${path}\n`);
    for (const path of replaced) process.stdout.write(`replaced ${path}: its bytes differed from the kit's; check git diff for a local edit\n`);
    for (const problem of problems) process.stderr.write(`agent-sync: ${problem}\n`);
    return problems.length ? 1 : 0;
  }
  const { actions, problems } = plan(root);
  for (const problem of problems) process.stderr.write(`agent-sync: ${problem}\n`);
  if (check) {
    for (const action of actions) process.stderr.write(`agent-sync: ${action.path} is out of date (run node scripts/agent-sync.mjs)\n`);
    return problems.length || actions.length ? 1 : 0;
  }
  if (problems.length) return 1;
  apply(root, actions);
  for (const action of actions) process.stdout.write(`${action.kind === 'unlink' ? 'removed' : 'wrote'} ${action.path}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
