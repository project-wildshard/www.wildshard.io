// shellcheck over the shared hook scripts and the git hooks (meta
// MULTI-AGENT-TOOLING MA7). Pinned exactly: CI installs this version and
// refuses any other; a local run with another version still checks and
// says so. Without shellcheck the suite fails on CI and skips locally.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHELLCHECK_VERSION = '0.11.0';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CI = process.env.CI === 'true';
const probe = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
const version = probe.status === 0 ? /version: (\S+)/.exec(probe.stdout)?.[1] ?? '?' : null;
const skip = version === null && !CI ? 'shellcheck is not installed (CI requires it)' : false;

/** Shell scripts by extension or shebang, in the agent hooks and the git hooks. */
function shellFiles() {
  const out = [];
  for (const dir of ['.agents/hooks', '.githooks']) {
    if (!existsSync(join(REPO, dir))) continue;
    for (const name of readdirSync(join(REPO, dir)).sort()) {
      const path = `${dir}/${name}`;
      if (!statSync(join(REPO, path)).isFile() || /\.(?:mjs|js|ts|json|md|py)$/.test(name)) continue;
      const head = readFileSync(join(REPO, path), 'utf8').split('\n', 1)[0];
      if (name.endsWith('.sh') || /^#!.*\b(?:ba|z)?sh\b/.test(head)) out.push(path);
    }
  }
  return out;
}
const check = (files, cwd = REPO) => spawnSync('shellcheck', ['--external-sources', ...files], { cwd, encoding: 'utf8' });

describe('shellcheck', { skip }, () => {
  test(`is the pinned ${SHELLCHECK_VERSION}`, (t) => {
    assert.notEqual(version, null, 'shellcheck is not on PATH');
    if (CI) assert.equal(version, SHELLCHECK_VERSION);
    else if (version !== SHELLCHECK_VERSION) t.diagnostic(`local shellcheck ${version}, CI pins ${SHELLCHECK_VERSION}`);
  });
  test('passes every hook script', () => {
    const files = shellFiles();
    assert.ok(files.some((path) => path.startsWith('.agents/hooks/')), 'no hook scripts found');
    const result = check(files);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
  test('goes red on a planted fault and green on the fix', () => {
    const scratch = join(REPO, 'tmp', 'agent-shellcheck-test');
    mkdirSync(scratch, { recursive: true });
    const box = mkdtempSync(join(scratch, 'box-'));
    after(() => rmSync(scratch, { recursive: true, force: true }));
    writeFileSync(join(box, 'bad.sh'), '#!/usr/bin/env bash\ndir="$1"\nrm -rf $dir/cache\n');
    writeFileSync(join(box, 'good.sh'), '#!/usr/bin/env bash\ndir="$1"\nrm -rf "$dir/cache"\n');
    const bad = check(['bad.sh'], box);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout, /SC2086/);
    assert.equal(check(['good.sh'], box).status, 0);
  });
});
