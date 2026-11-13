// DEV-SPEED DS11 guard, repo-kit copy (J221, J240): a plan worktree under <repo>/.worktrees/<plan> is invisible to
// the parent checkout's tools. It plants a worktree-shaped tree under this checkout's own .worktrees/ holding a lint
// error, failing tests, an index.html and a secret-shaped string (and, for the size check, a file one byte over the
// repo's blob cap), then runs the parent's tools and fails if any of them sees a planted file:
//   - Git ignores it, so nothing of it can be staged; the kit's own secrets and size checks (.githooks/lib.mjs
//     checkBlob, what pre-commit runs per staged blob) do flag the planted files when forced into a scratch index;
//   - oxlint, with every root lint config the repo has, and oxfmt over the whole root;
//   - test discovery: `vitest list` when the repo uses Vitest, and every `node --test` glob in package.json, each of
//     which must find files; a `node --test` with no glob (Node's default discovery walks every folder) fails;
//   - Vite's dependency-scan crawl (`**/*.html`, Vite's own globber and options) when the repo uses Vite.
// Every tool the repo's package.json or configs name must be installed: a missing one fails, never skips.
// Ships byte-identical in every org repo beside scripts/worktree-ignore.mjs; run it with
// `node --test test/tooling/worktree-guard.test.mjs`. Engine keeps its own, wider guard
// (test/tooling/worktree-ignore.test.mjs: its watchers, its shardfile walk), so in a repo on plan worktrees (J240,
// scripts/land.mjs) that keeps such a guard this suite skips and says why; kit.mjs also pins it out for engine.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, globSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {WORKTREES, isWorktreePath} from '../../scripts/worktree-ignore.mjs';

const ROOT = realpathSync(resolve(import.meta.dirname, '../..'));
const LINT_ERROR = 'export const zzGuard = (value: any) => { debugger; return value }\n';
const FAILING = "import {expect, test} from 'vitest';\ntest('planted', () => { expect(1).toBe(2); });\n";
const FILES = {
  'zz-guard.ts': LINT_ERROR,
  'src/zz-guard.ts': LINT_ERROR,
  'scripts/zz-guard.mjs': 'debugger;\n',
  'src/zz-guard.test.ts': FAILING,
  'test/zz-guard.test.ts': FAILING,
  'test/tooling/zz-guard.test.mjs': "import {test} from 'node:test';\ntest('planted', () => { throw new Error('planted'); });\n",
  'index.html': '<!doctype html><script type="module" src="./zz-entry.ts"></script>\n',
  'zz-entry.ts': "import 'zz-missing-package';\n",
  // Built at run time, so this file itself carries no secret-shaped string.
  'scripts/zz-secret.mjs': `export const key = '${['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')}';\n`,
};
/** The planted tree, relative to ROOT; set once it is made. */
let plant = '';
let madeParent = false;
const planted = () => Object.keys(FILES).map(path => `${plant}/${path}`);

/** A plain child run: no parent test-runner state. */
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && !key.startsWith('NODE_TEST') && key !== 'TEST'));
/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [extra] */
const run = (command, args, extra = {}) => spawnSync(command, args, {cwd: ROOT, encoding: 'utf8', env: {...env, ...extra}, maxBuffer: 1 << 28, timeout: 120_000});
/** The planted paths a tool's output names. @param {string} text */
const seen = text => planted().filter(path => text.includes(path) || text.includes(join(ROOT, path)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
/** A tool from node_modules/.bin, else from the repo's npm-bin-deps folder (NM8: `binDependenciesDir`, .bin-deps/). @param {string} name */
const bin = name => [join(ROOT, 'node_modules/.bin', name), join(ROOT, pkg.binDependenciesDir ?? '.bin-deps', 'node_modules/.bin', name)]
  .find(path => existsSync(path)) ?? join(ROOT, 'node_modules/.bin', name);
const scripts = /** @type {Record<string, string>} */ (pkg.scripts ?? {});
// The repo's worktree mode (J240): a repo that lands through plan worktrees carries the land tool, scripts/land.mjs.
// One that also keeps its own, wider guard (engine: test/tooling/worktree-ignore.test.mjs) is guarded by that, not by
// this copy: its own guard knows its watchers and tools, so this suite skips there and says why.
const OWN_GUARD = 'test/tooling/worktree-ignore.test.mjs';
const ownGuard = existsSync(join(ROOT, 'scripts/land.mjs')) && existsSync(join(ROOT, OWN_GUARD))
  && `this repo uses plan worktrees (J240, scripts/land.mjs) and keeps its own guard, ${OWN_GUARD}`;
const rootFiles = readdirSync(ROOT);
/** Does the repo use `tool`: a package script runs it, or a root config of its name exists? @param {string} tool */
const uses = tool => Object.values(scripts).some(script => new RegExp(`(?:^|[\\s/'"])${tool}(?:[\\s'"]|$)`, 'u').test(script))
  || rootFiles.some(name => name.startsWith(`${tool}.config.`));

before(() => {
  if (ownGuard) return;
  const parent = join(ROOT, WORKTREES);
  if (!existsSync(parent)) { mkdirSync(parent); madeParent = true; }
  // Only a real folder of this checkout: a linked .worktrees/ would send the plant, and its removal, elsewhere.
  assert.ok(lstatSync(parent).isDirectory() && realpathSync(parent) === join(ROOT, WORKTREES), `${parent} is not a plain folder of this checkout`);
  plant = relative(ROOT, mkdtempSync(join(parent, 'ds11-guard-')));
  for (const [path, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(ROOT, plant, path)), {recursive: true});
    writeFileSync(join(ROOT, plant, path), body);
  }
});
after(() => {
  if (plant !== '' && basename(plant).startsWith('ds11-guard-')) rmSync(join(ROOT, plant), {recursive: true, force: true});
  // Only the parent this run made, and only while empty.
  if (madeParent) { try { rmdirSync(join(ROOT, WORKTREES)); } catch { /* Someone else's worktree is in it now. */ } }
});

describe('a planted plan worktree is invisible to the parent checkout', {skip: ownGuard}, () => {
  test('the ignore list names the root folder only', () => {
    assert.equal(isWorktreePath('.worktrees/plan/src/a.ts'), true);
    assert.equal(isWorktreePath('src/.worktrees/a.ts'), false);
    assert.ok(readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').includes('/.worktrees/'), '.gitignore lacks /.worktrees/');
  });

  test('Git ignores it, so nothing of it can be staged for the secrets and size checks', () => {
    assert.deepEqual(run('git', ['check-ignore', '--', ...planted()]).stdout.trim().split('\n').sort(), [...planted()].sort());
    assert.deepEqual(seen(run('git', ['status', '--porcelain', '--untracked-files=all']).stdout), []);
    const staged = run('git', ['add', '--all', '--dry-run']);
    assert.equal(staged.status, 0, staged.stderr);
    assert.deepEqual(seen(staged.stdout), []);
  });

  test("the kit's secrets and size checks would flag the planted files, had Git let them be staged", async () => {
    const {MAX_BYTES, blobSizes, checkBlob} = await import(join(ROOT, '.githooks/lib.mjs'));
    // One byte over this repo's own cap (the kit renders 1 MB, or 25 MB in engine and shard repos).
    writeFileSync(join(ROOT, plant, 'zz-big.txt'), Buffer.alloc(MAX_BYTES + 1, 120));
    // A scratch index: the shared one is never touched. Forced, because Git itself refuses these paths.
    mkdirSync(join(ROOT, 'tmp'), {recursive: true});
    const index = join(mkdtempSync(join(ROOT, 'tmp', 'worktree-guard-')), 'index');
    try {
      const paths = [`${plant}/scripts/zz-secret.mjs`, `${plant}/zz-big.txt`];
      const added = run('git', ['add', '--force', '--', ...paths], {GIT_INDEX_FILE: index});
      assert.equal(added.status, 0, added.stderr);
      const entries = run('git', ['ls-files', '--stage', '-z'], {GIT_INDEX_FILE: index}).stdout.split('\0').filter(Boolean).map(row => {
        const [meta = '', path = ''] = row.split('\t');
        const [mode, object] = meta.split(' ');
        return {path, object, mode};
      });
      assert.deepEqual(entries.map(entry => entry.path).sort(), [...paths].sort());
      const sizes = blobSizes(entries.map(entry => entry.object));
      const problems = entries.flatMap(entry => checkBlob(entry, sizes.get(entry.object) ?? 0, {}));
      assert.ok(problems.some(line => line.includes('zz-secret.mjs') && /looks like/u.test(line)), problems.join('\n'));
      assert.ok(problems.some(line => line.includes('zz-big.txt') && /MB cap/u.test(line)), problems.join('\n'));
    } finally { rmSync(dirname(index), {recursive: true, force: true}); }
  });

  test('oxlint, with every lint config at the root and in kit/, reports nothing from it', () => {
    const configs = [...rootFiles.filter(name => /^\.oxlintrc.*\.json$/u.test(name)), ...existsSync(join(ROOT, 'kit/.oxlintrc.json')) ? ['kit/.oxlintrc.json'] : []];
    assert.ok(configs.length > 0, 'no oxlint config');
    for (const config of configs) {
      const lint = run(bin('oxlint'), ['-c', config, '-f', 'json', '.']);
      assert.equal(lint.error, undefined);
      const report = JSON.parse(lint.stdout.slice(lint.stdout.indexOf('{')));
      assert.ok(report.number_of_files > 0, `${config} linted no files: ${lint.stderr}`);
      assert.deepEqual(seen(lint.stdout), [], config);
    }
  });

  test('a whole-root oxfmt check runs cleanly and lists nothing from it', () => {
    assert.ok(existsSync(join(ROOT, 'kit/.oxfmtrc.json')), 'no kit/.oxfmtrc.json');
    const format = run(bin('oxfmt'), ['-c', 'kit/.oxfmtrc.json', '--list-different', '.']);
    // --list-different exits 1 when some file differs; anything else, or any stderr, is a broken run. A whole root
    // always holds files outside the formatted folders, so an empty list means it formatted nothing.
    assert.equal(format.error, undefined);
    assert.ok([0, 1].includes(format.status ?? -1), `oxfmt exited ${String(format.status)}`);
    assert.equal(format.stderr, '');
    assert.ok(format.stdout.split('\n').filter(Boolean).length > 0, 'oxfmt listed no file at all');
    assert.deepEqual(seen(format.stdout), []);
  });

  test('Vitest discovers none of its tests', {skip: !uses('vitest') && 'the repo does not use Vitest'}, () => {
    assert.ok(existsSync(join(ROOT, 'node_modules/vitest/vitest.mjs')), 'the repo uses Vitest but it is not installed');
    const list = run(process.execPath, ['node_modules/vitest/vitest.mjs', 'list', '--filesOnly', '--json']);
    assert.equal(list.status, 0, list.stderr);
    assert.ok(JSON.parse(list.stdout.slice(list.stdout.indexOf('['))).length > 0, 'vitest listed no files');
    assert.deepEqual(seen(list.stdout), []);
  });

  test('every `node --test` in package.json names globs, each finds files, and none reaches it', () => {
    // Node options that take a separate value; every other option is a flag or `--name=value`.
    const VALUED = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--env-file', '--test-name-pattern',
      '--test-skip-pattern', '--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-timeout',
      '--test-shard', '--input-type', '--conditions', '-C', '--disable-warning']);
    /** Shell words of one command, quotes removed. @param {string} command */
    const words = command => [...command.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/gu)].map(part => part[1] ?? part[2] ?? part[3] ?? '');
    let commands = 0;
    for (const [name, script] of Object.entries(scripts)) {
      for (const command of script.split(/&&|\|\||;|\|/u)) {
        const argv = words(command.trim());
        if (argv[0] !== 'node' || !argv.includes('--test')) continue;
        commands++;
        /** @type {string[]} */
        const globs = [];
        for (let at = 1; at < argv.length; at++) {
          const word = argv[at] ?? '';
          if (VALUED.has(word)) { at++; continue; }
          if (!word.startsWith('-')) globs.push(word);
        }
        assert.ok(globs.length > 0, `${name}: \`${command.trim()}\` has no glob, so Node discovers tests in every folder`);
        for (const glob of globs) {
          const found = globSync(glob, {cwd: ROOT});
          assert.ok(found.length > 0, `${name}: ${glob} finds no file`);
          assert.deepEqual(seen(found.join('\n')), [], `${name}: ${glob}`);
        }
      }
    }
    assert.ok(commands > 0 || !Object.values(scripts).some(script => script.includes('--test')), 'a --test script was not parsed');
  });

  test("Vite's dependency-scan crawl finds none of its HTML", {skip: !uses('vite') && !uses('vitest') && 'the repo does not use Vite'}, async () => {
    const vite = join(ROOT, 'node_modules/vite/package.json');
    assert.ok(existsSync(vite), 'the repo uses Vite but it is not installed');
    // Vite 8's globEntries: tinyglobby over **/*.html from the root, ignoring node_modules, the build output, tests and coverage.
    const {glob} = await import(createRequire(realpathSync(vite)).resolve('tinyglobby'));
    const pages = await glob('**/*.html', {cwd: ROOT, absolute: true, ignore: ['**/dist/**', '**/__tests__/**', '**/coverage/**', '**/node_modules/**']});
    // The planted page is there to find: the same globber run inside the plant must find it.
    const inside = await glob('**/*.html', {cwd: join(ROOT, plant), absolute: true});
    assert.ok(inside.some(path => path.endsWith('/index.html')) && statSync(join(ROOT, plant, 'index.html')).isFile());
    assert.deepEqual(seen(pages.join('\n')), []);
  });
});
