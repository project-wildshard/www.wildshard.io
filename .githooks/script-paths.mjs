// Script-path guard (meta QA 11-25 row 82, J505). A layout move (the lean move put shard tools under src/scripts) left
// scripts pointing where nothing is: a ROOT one level off, an import of a file that never came across, a read of art that
// stayed behind, a browser tool whose repo installs no playwright. Each failed only when someone ran it. The push lane
// (run-checks.mjs) checks every tracked script under a `scripts/` folder or `proofs/`:
//   (a) import: a relative import (`from './x.mjs'`, `import('../y.mjs')`) names a file that exists;
//   (b) package: a bare import names a package its nearest package.json declares (any dependency kind), its own name,
//       or a Node builtin;
//   (c) root: a `ROOT` (or `REPO`, `REPO_ROOT`) built from import.meta (`new URL('../..', import.meta.url)`,
//       `join(import.meta.dirname, '..', '..')`) is the folder of the script's nearest package.json;
//   (d) path: a literal joined to that anchored root (`join(ROOT, 'art/x')`, `resolve(ROOT, flag('cameras', 'art/x'))`)
//       whose first folder the repo has exists; a ROOT from process.cwd() or a flag is the caller's tree, not judged (outputs under tmp/, progress/, out/, dist/ are not read, nor a path the
//       script checks with existsSync first or makes with mkdirSync).
//   (e) moved (meta QA 11-25 row 91): a lean repo (src/scripts/, no tracked scripts/) still names a folder the lean
//       move left (`scripts`, `kit/scripts`, `test/tooling`) where the new place holds it: a written path (`'scripts/x'`,
//       a `node -e` source's `./scripts/x`, `"$REPO/scripts/x"`, `${root}/scripts/x`), a join part on any base
//       (`join(root, 'scripts', file)`, `ROOT / 'scripts' / name`), a regex (`/^scripts\//`), a Python or shell
//       climb counted from the old depth, a workflow's sparse checkout or `paths:`, a package.json script; and a
//       `pnpm <x:y>` in shell, a workflow or package.json whose script the package no longer has. Every code file is
//       read (.py, .sh and tests too, .agents/ aside), with .github/workflows/ and package.json.
// Code inside strings is not this file's code: a template literal (nested ones too) and a quoted string that can't be a
// module name (a `node -e` source, a worker body) are blanked first. A line that names a file the build writes beside
// the script says so in a comment, `// script-paths: <why>`, and is not judged. A missing target the repo's .gitignore
// covers is a build output (a `*.generated.ts`, a copied wasm), so a fresh checkout and a built one get one verdict.
// Findings are lines (`<file>: <check> <what>`). The repo's own baseline, `.githooks/script-paths.baseline.json` (never
// stamped), lists the ones it still carries; it may only shrink. A repo with no baseline is report-only: its findings
// print and the push passes, until `--write` records them.
//   node .githooks/script-paths.mjs [--write | --prune]   (exit 1 when refused)
// Bypass in the push lane: SKIP_SCRIPT_PATHS=1 (J381).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE = '.githooks/script-paths.baseline.json';
const SCRIPT = /\.(?:[cm]?js)$/u;
const IN_SCOPE = /(?:^|\/)scripts\/|^proofs\//u;
const SKIP = ['project/', 'leftover/', 'node_modules/'];
const OUTPUTS = new Set(['tmp', 'progress', 'out', 'dist', 'build', '.cache', 'coverage']);
const BUILTIN = new Set(builtinModules);
/** A relative specifier names a file as written, or (a TypeScript-style import) with one of these endings. */
const SPECIFIER = /^[\w@./:#+~-]+$/u;
const RESOLVES = ['','.ts', '.mts', '.mjs', '.js', '/index.ts', '/index.mjs', '/index.js'];
const ROOT_NAME = '(?:ROOT|REPO|REPO_ROOT)';
const IMPORT = /(?<![\w.$'"`-])(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"\s]+)['"]/gu;
const ANCHOR = new RegExp(`\\bconst\\s+(${ROOT_NAME})\\s*=\\s*([^;\\n]*import\\.meta[^;\\n]*)`, 'u');
const JOINED = new RegExp(`\\b(?:join|resolve|resolvePath|pathResolve)\\(\\s*${ROOT_NAME}\\s*,\\s*(?:flag\\(\\s*['"][^'"]+['"]\\s*,\\s*)?['"]([^'"$\`\\n]+)['"]`, 'gu');

/** A text with its comments blanked (line lengths kept), so a path in prose is never read as code. @param {string} text */
function code(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, blank).replaceAll(/(^|[^:'"`\\])(\/\/[^\n]*)/gmu, (_, before, comment) => `${before}${blank(comment)}`);
}

/** @param {string} text */
function blank(text) {
  return text.replaceAll(/[^\n]/gu, ' ');
}

/** The text with every template literal (nested ones too) and every quoted string that can't be a module name blanked,
 *  offsets kept: a script's `node -e` source or generated code (an import inside a string) is not this file's import.
 *  @param {string} text */
export function statements(text) {
  const chars = text.split('');
  const wipe = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let k = from; k < Math.min(to, chars.length); k++) if (chars[k] !== '\n') chars[k] = ' ';
  };
  /** @type {number[]} open braces inside each `${…}` we are in */
  const depth = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (!SPECIFIER.test(text.slice(i + 1, j))) wipe(i, j + 1);
      i = j + 1;
    } else if (ch === '`' || (ch === '}' && depth.at(-1) === 0)) {
      if (ch === '}') depth.pop();
      let j = i + 1;
      while (j < text.length && text[j] !== '`' && !(text[j] === '$' && text[j + 1] === '{')) j += text[j] === '\\' ? 2 : 1;
      wipe(i, j + 1);
      if (text[j] === '$') {
        depth.push(0);
        i = j + 2;
      } else i = j + 1;
    } else {
      if (ch === '{' && depth.length > 0) depth[depth.length - 1]++;
      else if (ch === '}' && depth.length > 0) depth[depth.length - 1]--;
      i++;
    }
  }
  return chars.join('');
}

/** Whether the path joined at `at` is one the script checks with existsSync first or makes with mkdirSync (an output):
 *  on its own line, or through the const it is assigned to. @param {string} text @param {number} at */
function optional(text, at) {
  const start = text.lastIndexOf('\n', at) + 1, end = text.indexOf('\n', at);
  if (/\b(?:existsSync|mkdirSync)\(/u.test(text.slice(start, end === -1 ? undefined : end))) return true;
  const name = /\bconst\s+(\w+)\s*=\s*$/u.exec(text.slice(start, at))?.[1];
  return name !== undefined && new RegExp(`(?:existsSync|mkdirSync)\\(\\s*${name}\\s*[,)]`, 'u').test(text);
}

/** The package name of a bare specifier (`@scope/name/x` is `@scope/name`). @param {string} spec */
function packageOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The folder a `ROOT = …import.meta…` expression names, relative to the repo, or null when it is no plain form.
 *  @param {string} file the script's repo path @param {string} expression */
export function anchorOf(file, expression) {
  const here = posix.dirname(file);
  const url = /new URL\(\s*['"]([./]+)['"]\s*,\s*import\.meta\.url\s*\)/u.exec(expression);
  const tidy = (/** @type {string} */ path) => posix.normalize(path).replace(/\/$/u, '') || '.';
  if (url !== null) return tidy(posix.join(here, url[1]));
  const joined = /\b(?:join|resolve|resolvePath|pathResolve)\(\s*import\.meta\.dirname((?:\s*,\s*['"]\.\.['"])*)\s*\)/u.exec(expression);
  if (joined !== null) return tidy(posix.join(here, ...(joined[1].match(/\.\./gu) ?? [])));
  return null;
}

/**
 * Every finding in the given scripts.
 * @param {{ paths: string[], read: (path: string) => string, exists: (path: string) => boolean, ignored?: (path: string) => boolean }} repo
 *   `paths` are the tracked repo paths; `exists` answers for a repo path (a file or a folder); `ignored` for one .gitignore covers.
 * @returns {string[]}
 */
export function scriptPathFindings({ paths, read, exists: on, ignored = () => false }) {
  const exists = (/** @type {string} */ path) => on(path) || ignored(path);
  const tops = new Set(paths.map((path) => path.split('/')[0]));
  /** @type {Map<string, { dir: string, names: Set<string> }>} */
  const packages = new Map();
  /** The nearest package.json above a repo path: its folder and the names it may import. @param {string} file */
  const packageFor = (file) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      const at = dir === '.' ? 'package.json' : `${dir}/package.json`;
      if (exists(at)) {
        if (!packages.has(at)) {
          const manifest = JSON.parse(read(at));
          const names = new Set([manifest.name, ...['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((kind) => Object.keys(manifest[kind] ?? {}))]);
          packages.set(at, { dir, names });
        }
        return packages.get(at);
      }
      if (dir === '.') return null;
    }
  };
  const findings = [];
  for (const file of [...paths].sort()) {
    if (!SCRIPT.test(file) || !IN_SCOPE.test(file) || SKIP.some((prefix) => file.startsWith(prefix)) || file.includes('/fixtures/')) continue;
    let raw;
    try {
      raw = read(file);
    } catch {
      continue;
    }
    const text = code(raw), lines = raw.split('\n');
    /** The raw line holding an offset. @param {number} at */
    const lineAt = (at) => lines[raw.slice(0, at).split('\n').length - 1] ?? '';
    const marked = (/** @type {number} */ at) => /\/[/*]\s*script-paths:/iu.test(lineAt(at)) || ABOVE.test(lines[raw.slice(0, at).split('\n').length - 2] ?? '');
    const pkg = packageFor(file);
    for (const { 1: spec, index } of statements(text).matchAll(IMPORT)) {
      if (!SPECIFIER.test(spec) || marked(index)) continue; // a regex or a pattern in the code, not a module name
      if (spec.startsWith('.')) {
        const target = posix.normalize(posix.join(posix.dirname(file), spec));
        if (!RESOLVES.some((ending) => exists(`${target}${ending}`))) findings.push(`${file}: import ${spec} (no ${target})`);
      } else if (!spec.startsWith('node:') && !spec.startsWith('#') &&!BUILTIN.has(spec) && !spec.includes('${') && pkg !== null && !pkg.names.has(packageOf(spec))) {
        findings.push(`${file}: package ${packageOf(spec)} (not in ${pkg.dir === '.' ? '' : `${pkg.dir}/`}package.json)`);
      }
    }
    const anchor = ANCHOR.exec(text);
    const root = anchor === null ? null : anchorOf(file, anchor[2]);
    if (anchor !== null && root !== null && pkg !== null && root !== pkg.dir) {
      findings.push(`${file}: root ${anchor[1]} is ${root === '.' ? 'the repo root' : root}, not the package root ${pkg.dir === '.' ? '(the repo root)' : pkg.dir}`);
    }
    for (const { 1: literal, index } of text.matchAll(JOINED)) {
      const first = literal.split('/')[0];
      if (OUTPUTS.has(first) || literal.startsWith('/') || literal.startsWith('.') || marked(index) || optional(text, index)) continue;
      if (root === null) continue;
      if (root === '.' && !tops.has(first)) continue;
      const target = posix.normalize(posix.join(root, literal));
      if (!exists(target)) findings.push(`${file}: path ${literal} (no ${target})`);
    }
  }
  return [...new Set(findings)];
}

/** The folders the lean layout moved, and where each went (engine f928fdae2, repo-kit R2); the longer name first. */
export const LEAN_MOVES = [['kit/scripts', 'src/scripts/.kit'], ['test/tooling', 'src/test'], ['scripts', 'src/scripts']]; // script-paths: the moves themselves
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|sh|bash)$/u;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/u;
// A lint that wants capitalised comments (oxlint capitalized-comments) writes it `// Script-paths:`, so either case.
const MARKED = /(?:\/\/|\/\*|#)\s*script-paths:/iu;
// A lint that bans inline comments (oxlint no-inline-comments) puts the mark alone on the line above, as
// `// Script-paths: <why>`; it covers the next line only.
const ABOVE = /^\s*(?:\/\/|\/\*|#)\s*script-paths:/iu;
const FOLDER = String.raw`(?:kit\/scripts|test\/tooling|scripts)`; // script-paths: the moved folders themselves
/** A path naming a moved folder, rooted at the line's start, a quote, a space or a variable (`$REPO/`, `${root}/`). */
const MOVED_PATH = new RegExp(String.raw`(^|[^\w.@/$\\-]|\$\{?\w+\}?\/|\}\/|\)\/)((?:\.{1,2}\/)*)(${FOLDER}(?:\/[\w.@*-]+)*)(\/?)(?![\w@*-])`, 'gmu');
/** A quoted folder part of a join (`join(root, 'scripts', file)`, `ROOT / 'scripts' / name`). */
const PART = /(['"])(scripts|tooling)\1/gu;
/** The text before a quoted part that is still inside a path call's parentheses. */
const PATH_CALL = /\b(?:join|resolve|resolvePath|pathResolve|Path|mkdirSync|existsSync|readdirSync|rmSync|cpSync)\((?:[^()]|\([^()]*\))*$/u;
/** A regex naming a moved folder (`/^scripts\//`, `(?:kit\/scripts)\/`). */
const REGEX = /(?:^|[\^(|:]|(?<!\\)\/)(kit\\\/scripts|test\\\/tooling|scripts)\\\//gu; // script-paths: the moved folders themselves
/** A run of a namespaced package script (`pnpm test:hooks`, `['pnpm','run','--silent','check:asks']`): never a pnpm command. */
const PNPM_RUN = /\bpnpm\s+(?:run\s+)?(?:--silent\s+)?([a-z][\w-]*:[\w:-]+)|\[\s*['"]pnpm['"]\s*,\s*(?:['"]run['"]\s*,\s*)?(?:['"]--silent['"]\s*,\s*)?['"]([a-z][\w-]*:[\w:-]+)['"]/gu;
/** A Python or shell climb to the repo root, assigned to ROOT, REPO or REPO_ROOT. */
const PY_CLIMB = /^\s*(ROOT|REPO|REPO_ROOT)\s*=.*?Path\(__file__\)(?:\.resolve\(\))?(?:((?:\.parent(?!s))+)|\.parents\[(\d+)\])/mu;
const SH_CLIMB = /^\s*(ROOT|REPO|REPO_ROOT)=.*?\$\(dirname\s+(?:--\s+)?"?\$(?:0|\{BASH_SOURCE\[0\]\}|BASH_SOURCE)"?\)((?:\/\.\.)*)/mu;

/** The text with JavaScript comments blanked (line lengths kept), quotes and templates read as strings: unlike code(), a
 *  string holding `/*` or `//` (a glob, a URL) is not a comment. @param {string} text */
function uncommented(text) {
  const chars = text.split('');
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === '\\') i++;
      else if (ch === quote || (ch === '\n' && quote !== '`')) quote = '';
    } else if (ch === '\\') i++;
    else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const close = text[i + 1] === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i + 2) + 2;
      const end = close <= 1 || close === -1 ? text.length : close;
      for (let k = i; k < end; k++) if (chars[k] !== '\n') chars[k] = ' ';
      i = end - 1;
    }
  }
  return chars.join('');
}

/** The text with `#` comments blanked (line lengths kept): Python, shell and YAML. @param {string} text */
function hashless(text) {
  return text.replaceAll(/(^|\s)(#[^\n]*)/gmu, (_, before, comment) => `${before}${blank(comment)}`);
}

/**
 * Meta QA 11-25 row 91: every place a lean repo still names a folder the lean move left (`scripts/`, `kit/scripts/`,
 * `test/tooling/`) where the moved folder now holds it. Row 82's checks judged only imports and joins on an anchored
 * uppercase ROOT in scripts/ .mjs files, so these went through: a join on a clone or a lowercase root
 * (`join(checkout, 'scripts', 'online-rig.mjs')`, `join(root, 'scripts', file)`), a temp checkout's folder
 * (`mkdirSync(join(producer, 'scripts'))`, `(self.root / 'scripts').mkdir()`), a tool list's `'kit/scripts/asks.mjs'`,
 * a `node -e` source's `'./scripts/x.mjs'`, a shell `"$REPO/scripts/x.py"`, a template's `${root}/scripts/x.mjs`, a
 * regex's `/^scripts\//`, a Python or shell climb counted from the old depth, a workflow's sparse checkout or `paths:`
 * filter, and package.json scripts. Code files anywhere (tests and fixtures too), .github/workflows and package.json
 * scripts are read; a path is judged only when the move's new place holds it (meta's own scripts/ and long-gone tools
 * are not this move's). A line marked `script-paths: <why>` is not judged.
 * @param {{ paths: string[], read: (path: string) => string, exists: (path: string) => boolean }} repo
 * @returns {string[]}
 */
export function movedFindings({ paths, read, exists }) {
  const moves = LEAN_MOVES.filter(([from, to]) => !paths.some((path) => path.startsWith(`${from}/`)) && exists(to));
  if (moves.length === 0) return [];
  /** @type {string[]} */
  const findings = [];
  /** A finding when `path` is under a moved folder and only the new place holds it. */
  const judge = (/** @type {string} */ file, /** @type {string} */ path, /** @type {string} */ written) => {
    const move = moves.find(([from]) => path === from || path.startsWith(`${from}/`));
    if (move === undefined) return;
    // a nested package that holds the path itself (sharddev's packages/sdk/scripts/): the path is that package's, not
    // the root's that moved; a path climbing out with ../ was resolved from the repo root already
    const home = packageDir(file), glob = path.indexOf('*');
    const own = glob === -1 ? path : path.slice(0, Math.max(0, path.lastIndexOf('/', glob)));
    if (home !== '.' && !written.startsWith('.') && exists(`${home}/${own}`)) return;
    const now = `${move[1]}${path.slice(move[0].length)}`, at = now.indexOf('*');
    const held = at === -1 ? exists(now) : exists(now.slice(0, Math.max(0, now.lastIndexOf('/', at))));
    if (held && !exists(path)) findings.push(`${file}: moved ${written} (${move[0]}/ is ${move[1]}/ now)`);
  };
  /** The folder of the nearest package.json above a file. @param {string} file */
  const packageDir = (file) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      if (exists(dir === '.' ? 'package.json' : `${dir}/package.json`) || dir === '.') return dir;
    }
  };
  /** @type {Map<string, Record<string, string> | null>} */
  const manifests = new Map();
  /** A package folder's scripts, or null when it has no readable package.json. @param {string} dir */
  const scriptsOf = (dir) => {
    if (!manifests.has(dir)) {
      try {
        manifests.set(dir, JSON.parse(read(dir === '.' ? 'package.json' : `${dir}/package.json`)).scripts ?? {});
      } catch {
        manifests.set(dir, null);
      }
    }
    return manifests.get(dir) ?? null;
  };
  for (const file of [...paths].sort()) {
    // .agents/ is synced from meta into every repo, lean or not: its kit/scripts/ and scripts/ fallbacks are on purpose
    if (SKIP.some((prefix) => file.startsWith(prefix)) || file.startsWith('.agents/')) continue;
    const manifest = file === 'package.json' || file.endsWith('/package.json'), workflow = WORKFLOW.test(file);
    if (!manifest && !workflow && !CODE_FILE.test(file)) continue;
    let raw;
    try {
      raw = read(file);
    } catch {
      continue;
    }
    let text = raw;
    if (manifest) {
      try {
        text = Object.values(JSON.parse(raw).scripts ?? {}).join('\n');
      } catch {
        continue;
      }
    } else text = /\.(?:py|sh|bash|ya?ml)$/u.test(file) ? hashless(raw) : uncommented(raw.replaceAll(/^\s*(?:\/\/|\/\*|\*).*$/gmu, blank));
    const lines = manifest ? text.split('\n') : raw.split('\n');
    const marked = (/** @type {number} */ at) => {
      const line = text.slice(0, at).split('\n').length - 1;
      return MARKED.test(lines[line] ?? '') || (!manifest && ABOVE.test(lines[line - 1] ?? ''));
    };
    // a path written out: 'scripts/x.mjs', './scripts/x' in a `node -e` source, "$REPO/scripts/x.py", `${root}/scripts/x`
    for (const match of text.matchAll(MOVED_PATH)) {
      const [, lead, dots, path, slash] = match, at = match.index + lead.length;
      if (marked(at)) continue;
      // a bare folder only from a variable ("$REPO/scripts"), with its slash (scripts/) or as a list line (sparse checkout)
      const listed = /^\s*-?\s*['"]?$/u.test(text.slice(text.lastIndexOf('\n', at - 1) + 1, at)) && /^['"]?\s*$/mu.test(text.slice(at + path.length + slash.length).split('\n')[0]);
      if (!path.includes('/') && slash === '' && !lead.endsWith('/') && !(workflow && listed)) continue;
      const resolved = dots.includes('..') ? posix.normalize(posix.join(posix.dirname(file), `${dots}${path}`)) : path;
      if (!resolved.startsWith('..')) judge(file, resolved, `${dots}${path}${slash}`);
    }
    // a package script the lean package.json dropped: `pnpm test:hooks` in ci-static.sh (f928fdae2's static red); shell,
    // workflows and package.json only (the kit's own hooks run a script only when the repo declares it)
    const scripts = manifest || workflow || /\.(?:sh|bash)$/u.test(file) ? scriptsOf(packageDir(file)) : null;
    for (const match of text.matchAll(PNPM_RUN)) {
      const name = match[1] ?? match[2];
      if (scripts !== null && !(name in scripts) && !marked(match.index)) findings.push(`${file}: moved pnpm ${name} (no such script in ${packageDir(file) === '.' ? '' : `${packageDir(file)}/`}package.json)`);
    }
    if (workflow || manifest) continue;
    // a folder joined as a part: join(root, 'scripts', file), ROOT / 'scripts' / name, (root / 'scripts').mkdir()
    for (const match of text.matchAll(PART)) {
      const at = match.index, before = text.slice(Math.max(0, at - 80), at), after = text.slice(at + match[0].length);
      // only a part of a path call (join, resolve, Path, mkdirSync…) or a Python `/`: never a key, a member, a type or `in`
      if (marked(at) || !(PATH_CALL.test(before) || /\s\/\s*$/u.test(before))) continue;
      const previous = /(['"])([\w.@-]+)\1\s*(?:,|\/)\s*$/u.exec(before)?.[2];
      let path = match[2];
      // 'test', 'tooling' and 'kit', 'scripts' are moved folders; 'src', 'scripts' is the new place, another literal another folder
      if (path === 'tooling' ? previous !== 'test' : previous !== undefined && previous !== 'kit') continue;
      if (previous !== undefined) path = `${previous}/${path}`;
      const next = /^\s*(?:,|\/)\s*(['"])([\w.@*-]+(?:\/[\w.@*-]+)*)\1/u.exec(after);
      if (next !== null) path += `/${next[2]}`;
      judge(file, path, `${match[0]}${next === null ? '' : `, ${next[1]}${next[2]}${next[1]}`}`);
    }
    // a regex naming the folder: /^scripts\//
    for (const match of text.matchAll(REGEX)) {
      if (!marked(match.index)) judge(file, match[1].replaceAll('\\/', '/'), `${match[1]}\\/`);
    }
    // a climb counted from the old depth: ROOT = Path(__file__).parent in a tool one folder deeper now, REPO=$(dirname $0)/..
    const climb = PY_CLIMB.exec(text) ?? SH_CLIMB.exec(text);
    if (climb !== null && !marked(climb.index) && moves.some(([, to]) => file.startsWith(`${to}/`))) {
      const up = climb[3] !== undefined ? Number(climb[3]) + 1
        : climb[2]?.startsWith('.parent') ? climb[2].split('.parent').length - 1 : 1 + (climb[2]?.match(/\.\./gu) ?? []).length;
      let dir = file;
      for (let k = 0; k < up; k++) dir = posix.dirname(dir);
      const home = packageDir(file), name = (/** @type {string} */ at) => (at === '.' ? 'the repo root' : at);
      if (dir !== home) findings.push(`${file}: moved climb ${climb[1]} is ${name(dir)}, not ${name(home)}`);
    }
  }
  return [...new Set(findings)];
}

/** Compare with the shrink-only baseline. @param {string[]} found @param {string[]} baseline */
export function judge(found, baseline) {
  const known = new Set(baseline), now = new Set(found);
  return { added: found.filter((line) => !known.has(line)), shrunk: baseline.filter((line) => !now.has(line)) };
}

/** The repo at `root`, judged: its tracked scripts against its baseline. @param {string} root */
export function scriptPathsVerdict(root) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
  const ignored = (/** @type {string} */ path) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: root, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  const read = (/** @type {string} */ path) => readFileSync(join(root, path), 'utf8'), exists = (/** @type {string} */ path) => existsSync(join(root, path));
  const found = [...scriptPathFindings({ paths, read, exists, ignored }), ...movedFindings({ paths, read, exists })];
  const file = join(root, BASELINE), recorded = existsSync(file);
  /** @type {string[]} */
  const baseline = recorded ? JSON.parse(readFileSync(file, 'utf8')).findings ?? [] : [];
  return { found, baseline, enforced: recorded, ...judge(found, baseline) };
}

/** The refusal's text. @param {string[]} added */
export function refusal(added) {
  return `script-paths (meta QA 11-25 row 82): a script points where nothing is; fix the path, or declare the package:\n${added.map((line) => `  ${line}`).join('\n')}`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const { found, baseline, enforced, added, shrunk } = scriptPathsVerdict(root);
  const write = process.argv.includes('--write');
  if (write || process.argv.includes('--prune')) {
    const findings = write ? found : baseline.filter((line) => found.includes(line));
    mkdirSync(dirname(join(root, BASELINE)), { recursive: true });
    writeFileSync(join(root, BASELINE), `${JSON.stringify({ about: 'meta QA 11-25 row 82: script paths that point where nothing is, still carried; shrink only (node .githooks/script-paths.mjs --prune).', findings }, null, 1)}\n`);
    console.log(`script-paths: baseline written, ${findings.length} finding(s)`);
  } else if (shrunk.length > 0) {
    console.log(`script-paths: ${shrunk.length} baselined finding(s) are gone; run node .githooks/script-paths.mjs --prune and commit it`);
  }
  if (added.length > 0 && !write && enforced) {
    console.error(refusal(added));
    process.exitCode = 1;
  } else if (added.length > 0 && !write) {
    console.log(`script-paths: report only (no ${BASELINE} yet):\n${added.map((line) => `  ${line}`).join('\n')}`);
  } else {
    console.log(`script-paths: ${found.length} baselined finding(s), none new`);
  }
}
