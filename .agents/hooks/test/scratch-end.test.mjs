// J358: SessionEnd only reports; even the obsolete purge flag cannot delete.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('ending a session preserves owned, foreign, ownerless and linked scratch', () => {
  const root = resolve('tmp/codex-netlag/scratch-end-fixture');
  mkdirSync(join(root, '.agents/hooks'), { recursive: true });
  const hook = join(root, '.agents/hooks/scratch-end.mjs');
  cpSync('.agents/hooks/scratch-end.mjs', hook);
  try {
    for (const name of ['mine', 'foreign', 'ownerless', '.scratch-trash']) {
      mkdirSync(join(root, 'tmp', name), { recursive: true });
      writeFileSync(join(root, 'tmp', name, 'proof'), name);
    }
    writeFileSync(join(root, 'tmp/mine/.owner'), JSON.stringify({ session: 'ending', task: 'mine' }));
    writeFileSync(join(root, 'tmp/foreign/.owner'), JSON.stringify({ session: 'other' }));
    mkdirSync(join(root, 'tmp/busy/dev-123'), { recursive: true });
    writeFileSync(join(root, 'tmp/busy/.owner'), JSON.stringify({ session: 'ending' }));
    writeFileSync(join(root, 'tmp/busy/dev-123/server.pid'), String(process.pid));
    symlinkSync(join(root, 'tmp/mine'), join(root, 'tmp/linked'));
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ session_id: 'ending', cwd: '/' }), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /tmp\/mine.*Copy first/u);
    assert.doesNotMatch(result.stdout, /tmp\/foreign/u);
    assert.doesNotMatch(result.stdout, /tmp\/busy/u);
    const purge = spawnSync(process.execPath, [hook, '--purge'], { encoding: 'utf8' });
    assert.equal(purge.status, 0);
    for (const name of ['mine', 'foreign', 'ownerless', '.scratch-trash'])
      assert.equal(readFileSync(join(root, 'tmp', name, 'proof'), 'utf8'), name);
    assert.ok(existsSync(join(root, 'tmp/linked')));
    assert.ok(!existsSync(join(root, 'tmp/.scratch.log')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
