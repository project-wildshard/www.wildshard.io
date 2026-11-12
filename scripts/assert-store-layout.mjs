// GVS G9 (J230): prove the real install uses pnpm's global virtual store.
// CI runs it right after `pnpm install --config.ci=false`: pnpm turns the
// store off whenever ci is true, so a kit sync must never undo the layout.
// A repo with more to prove (engine's own deps, an ambient sharp) keeps its
// own copy; the sync reports that as diverged and leaves it alone.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

if (process.env.GITHUB_ACTIONS === 'true') assert.equal(process.env.CI, 'true', 'Hosted runner must retain CI');
const modules = JSON.parse(readFileSync('node_modules/.modules.yaml', 'utf8'));
assert.equal(typeof modules.storeDir, 'string');
assert.equal(typeof modules.virtualStoreDir, 'string');
const store = realpathSync(modules.storeDir);
const links = realpathSync(resolve('node_modules', modules.virtualStoreDir));
assert.equal(links, resolve(store, 'links'), 'The installer selected a checkout-local virtual store');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const roots = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
for (const name of roots) {
  const slot = realpathSync(resolve('node_modules', name));
  assert.ok(slot.startsWith(links + sep), `${name} reached outside the installed store`);
}
console.log(`global-store-layout ${JSON.stringify({ store, links, declaredRoots: roots.length, runnerCi: process.env.CI })}`);
