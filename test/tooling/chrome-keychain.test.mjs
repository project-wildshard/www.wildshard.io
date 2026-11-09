// Jake, 2026-11-09: launch files use the shared flags; defaults stay on.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { KEYCHAIN_ARGS } from '../../scripts/chromium-keychain.mjs';
import { keychainProblems } from '../../scripts/chromium-keychain-check.mjs';

const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8', maxBuffer: 32 << 20,
}).split('\0');
const files = [...new Set(paths)]
  .filter(file => /\.(?:[cm]?[jt]sx?|sh)$/u.test(file)
    && !/^(?:node_modules|tmp|public|art|docs|project\/archive)\//u.test(file)
    && !file.endsWith('chrome-keychain.test.mjs')
    && !file.endsWith('chromium-keychain-check.mjs') && existsSync(file))
  .map(file => ({ file, text: readFileSync(join(process.cwd(), file), 'utf8') }));

test('Chromium launch files spread the shared keychain flags', () => {
  assert.deepEqual(KEYCHAIN_ARGS, ['--use-mock-keychain', '--password-store=basic']);
  const bare = files.flatMap(({ file, text }) => keychainProblems(text).map(problem => `${file}: ${problem}`));
  assert.deepEqual(bare, [], 'Import and spread scripts/chromium-keychain.mjs KEYCHAIN_ARGS at every Chromium launch');
});

test('raw executable aliases and every child-process API are checked', () => {
  for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
    for (const binary of ["'/cache/Google Chrome for Testing.app/Chrome for Testing'", "'/cache/chromium-1254/chrome'", 'chromium.executablePath()']) {
      const prefix = `import { ${method} } from 'node:child_process'; const otherName = ${binary}; const runner = otherName;`;
      assert.ok(keychainProblems(`${prefix} ${method}(runner, ['--headless']);`).length > 0, `${method} ${binary}`);
      assert.deepEqual(keychainProblems(`${prefix} ${method}(runner, [...KEYCHAIN_ARGS, '--headless']);`), []);
      for (const flag of KEYCHAIN_ARGS) assert.ok(keychainProblems(`${prefix} ${method}(runner, ['${flag}']);`).length > 0);
    }
  }
  assert.ok(keychainProblems("exec('/cache/chromium-1254/chrome --headless');").length > 0);
  assert.deepEqual(keychainProblems("exec('/cache/chromium-1254/chrome --use-mock-keychain --password-store=basic --headless');"), []);
  assert.ok(keychainProblems("import { execFile as run } from 'node:child_process'; run('/cache/chromium-1254/chrome', []);").length > 0);
  for (const method of ['launch', 'launchPersistentContext', 'launchServer']) {
    assert.ok(keychainProblems(`import { chromium } from 'playwright'; chromium.${method}({});`).length > 0);
    assert.deepEqual(keychainProblems(`import { chromium } from 'playwright'; chromium.${method}({args: [...KEYCHAIN_ARGS]});`), []);
  }
  assert.ok(keychainProblems("import { chromium } from 'playwright'; chromium.launch({args: [...KEYCHAIN_ARGS]}); chromium.launch({});").length > 0);
  assert.ok(keychainProblems("import { chromium } from 'playwright'; chromium.connect(endpoint);").length > 0);
  assert.ok(keychainProblems("import { chromium } from 'playwright'; const pattern = /['\"]/u; chromium.launch({});").length > 0);
});

test('no source drops Playwright default arguments', () => {
  const option = 'ignore' + 'DefaultArgs';
  assert.deepEqual(files.filter(({ text }) => text.includes(option)).map(({ file }) => file), []);
});
