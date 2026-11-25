// A9: `tsc` over the shard source with the root tsconfig.json (strictest
// flags). tsc refuses a project with no inputs (TS18003), so until the
// first .ts under src/ is tracked this says so and passes.
import { execFileSync, spawnSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '--', 'src/*.ts', ':!src/scripts', ':!src/test/.kit'], { encoding: 'utf8' });
if (tracked.trim() === '') {
  console.log('typecheck: no .ts under src/ yet; nothing to check');
} else {
  const run = spawnSync('pnpm', ['exec', 'npr', 'tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
}
