// REPO-KIT K1a: resolve the native lint helper through npr's public
// command. The cache layout is private to npr; never guess its path.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function lintEnvironment(root = process.cwd(), environment = process.env) {
  const manifest = resolve(root, 'package.json');
  if (!existsSync(manifest)) return environment;
  const pin = JSON.parse(readFileSync(manifest, 'utf8')).binDependencies?.['oxlint-tsgolint'];
  // Older consumers keep their installed helper until their K1b rollout.
  if (pin === undefined) return environment;
  if (typeof pin !== 'string' || !/^\d+\.\d+\.\d+$/u.test(pin)) throw new Error('Missing exact native lint pin');
  if (environment.OXLINT_TSGOLINT_PATH !== undefined) return environment;
  const found = spawnSync(resolve(root, 'node_modules/.bin/npr'), ['which', 'tsgolint'], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  const entry = found.stdout?.trim() ?? '';
  if (found.error !== undefined || found.status !== 0 || !isAbsolute(entry) || entry.includes('\n')) {
    throw new Error('Pinned native lint unavailable; run pnpm exec npr install --frozen');
  }
  const metadata = createRequire(entry).resolve('oxlint-tsgolint/package.json');
  const installed = JSON.parse(readFileSync(metadata, 'utf8'));
  if (installed.name !== 'oxlint-tsgolint' || installed.version !== pin) {
    throw new Error('Native lint helper differs from its manifest pin');
  }
  const binary = createRequire(metadata).resolve(
    `@oxlint-tsgolint/${process.platform}-${process.arch}/tsgolint${process.platform === 'win32' ? '.exe' : ''}`,
  );
  return { ...environment, OXLINT_TSGOLINT_PATH: binary };
}


if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const child = spawnSync('pnpm', ['exec', 'oxlint', ...process.argv.slice(2)], {
    cwd: process.cwd(), env: lintEnvironment(), stdio: 'inherit',
  });
  if (child.error !== undefined) throw child.error;
  process.exitCode = child.status ?? 1;
}
