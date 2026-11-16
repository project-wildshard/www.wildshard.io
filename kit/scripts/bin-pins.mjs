// REPO-KIT K1a: consumers share the exact committed binary install.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkBinPins(root = process.cwd()) {
  const pins = JSON.parse(readFileSync(resolve(root, 'kit/bin-pins.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const problems = [];
  if (pkg.devDependencies?.['npm-bin-deps'] !== pins.runner) problems.push('npm-bin-deps must match the kit runner pin');
  if (pkg.binDependenciesInstaller !== pins.installer) problems.push('binary installer must match the kit profile');
  if (pkg.binDependenciesDir !== undefined && pkg.binDependenciesDir !== '.bin-deps') problems.push('binary directory must be .bin-deps');
  const actual = pkg.binDependencies ?? {};
  if (Object.keys(actual).length !== Object.keys(pins.tools).length ||
      Object.entries(pins.tools).some(([key, value]) => actual[key] !== value)) {
    problems.push('binDependencies must match the kit tool pins exactly');
  }
  for (const [name, hash] of Object.entries(pins.files)) {
    try {
      const bytes = readFileSync(resolve(root, '.bin-deps', name));
      if (createHash('sha256').update(bytes).digest('hex') !== hash) problems.push(`.bin-deps/${name} differs from the kit cache profile`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      problems.push(`.bin-deps/${name} is missing`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const problems = checkBinPins();
  for (const problem of problems) console.error(problem);
  process.exitCode = problems.length ? 1 : 0;
}
