import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {ENV, roots} from './test-helpers.mjs';

const hook = fileURLToPath(new URL('run-checks.mjs', import.meta.url));
const scratch = fileURLToPath(new URL('../tmp/', import.meta.url));
const good = 'export const item = 1;\n';
const bad = 'export const item = 1;\nitem.invalid(); // broken\n';

function fixture() {
  mkdirSync(scratch, {recursive: true});
  const root = mkdtempSync(join(scratch, 'staged-check-'));
  roots.push(root);
  const git = (...args) => spawnSync('git', args, {
    cwd: root, encoding: 'utf8',
    env: {...ENV, PRECOMMIT_HARD_S: '30', WS_TEST_STAGED_HOOK: hook, WS_TEST_STAGED_NODE: process.execPath},
  });
  const write = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), bytes);
  };
  assert.equal(git('init', '-q', '-b', 'main').status, 0);
  assert.equal(git('config', 'user.name', 'Test').status, 0);
  assert.equal(git('config', 'user.email', 'test@example.com').status, 0);
  const files = {
    '.gitignore': 'node_modules/\ntmp/\n',
    'package.json': JSON.stringify({scripts: {
      lint: 'node checks.mjs lint',
      'format:check': 'node checks.mjs format',
      typecheck: 'node checks.mjs typecheck',
    }}),
    'src/main.ts': good,
    'src/other.ts': good,
    'checks.mjs': `import {readFileSync} from 'node:fs';
      const text = ['src/main.ts', 'src/other.ts'].map(file => readFileSync(file, 'utf8')).join('');
      if (text.includes('broken')) {
        console.error(process.argv[2] + ' read a broken source file');
        process.exitCode = 1;
      }`,
  };
  for (const [path, bytes] of Object.entries(files)) write(path, bytes);
  mkdirSync(join(root, 'node_modules'));
  assert.equal(git('add', '--', ...Object.keys(files)).status, 0);
  assert.equal(git('commit', '-qm', 'Initial fixture').status, 0);
  write('.git/hooks/pre-commit', '#!/bin/sh\nexec "$WS_TEST_STAGED_NODE" "$WS_TEST_STAGED_HOOK" commit\n');
  chmodSync(join(root, '.git/hooks/pre-commit'), 0o755);
  return {git, write};
}

test('pre-commit typecheck, lint and format see the staged bytes', () => {
  const {git, write} = fixture();
  const staged = 'export const item = 2;\n';
  write('src/main.ts', staged);
  assert.equal(git('add', '--', 'src/main.ts').status, 0);
  write('src/main.ts', bad);
  write('src/other.ts', bad);
  write('package.json', '{');
  const result = git('commit', '-m', 'Commit staged source');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /commit lane: pnpm lint, format:check, typecheck/u);
  assert.equal(git('show', 'HEAD:src/main.ts').stdout, staged);
  assert.equal(git('show', 'HEAD:src/other.ts').stdout, good);
  assert.match(git('diff', '--', 'src/other.ts').stdout, /broken/u);
});

test('a pathspec commit ignores the staging area outside its selected files', () => {
  const {git, write} = fixture();
  write('src/other.ts', bad);
  assert.equal(git('add', '--', 'src/other.ts').status, 0);
  write('src/main.ts', 'export const item = 3;\n');
  const selected = git('commit', '-m', 'Commit only selected source', '--', 'src/main.ts');
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(git('show', 'HEAD:src/other.ts').stdout, good);
  assert.match(git('diff', '--cached', '--', 'src/other.ts').stdout, /broken/u);
  const refused = git('commit', '-m', 'Commit broken source');
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /lint read a broken source file/u);
  assert.match(refused.stderr, /typecheck read a broken source file/u);
});
