#!/usr/bin/env node
// J329 (REPO-KIT K11): oxlint once per config. kit/.oxlintrc.json's
// overrides match paths from kit/, so a repo whose own code is in src/
// keeps src/.oxlintrc.json ({"extends": ["../kit/.oxlintrc.json"]}),
// whose overrides then match from src/. oxlint takes one root config a
// run, and a nested one may not set typeAware, so this runs it twice:
// src/ with src's config, everything else with kit's. With no
// src/.oxlintrc.json it is one plain run.
//
//   node kit/scripts/lint.mjs [oxlint flags] [paths...]
//
// Staged paths (the commit lane appends them) go to the run that owns
// them; with no paths each run lints its whole tree.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lintEnvironment } from './bin-tools.mjs';

const VALUED = new Set(['--ignore-pattern', '-c', '--config', '--tsconfig', '-A', '-D', '-W', '--allow', '--deny', '--warn']);
const flags = [];
const paths = [];
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--') continue;
  if (!arg.startsWith('-')) paths.push(arg);
  else if (VALUED.has(arg)) flags.push(arg, args[(index += 1)]);
  else flags.push(arg);
}
const KIT = 'kit/.oxlintrc.json';
const SRC = 'src/.oxlintrc.json';
const hasSrc = existsSync(SRC);
const inSrc = (path) => path === 'src' || path.startsWith('src/');
// Split, either run may own no files (a kit/ of ignored scripts, or only
// ignored paths staged): not an error.
const split = flags.includes('--no-error-on-unmatched-pattern') ? flags : [...flags, '--no-error-on-unmatched-pattern'];
const runs = !hasSrc
  ? [[KIT, paths]]
  : paths.length === 0
    ? [[KIT, ['--ignore-pattern', 'src/**']], [SRC, ['src']]]
    : [[KIT, paths.filter((path) => !inSrc(path))], [SRC, paths.filter(inSrc)]].filter(([, owned]) => owned.length > 0);
const env = lintEnvironment();
for (const [config, owned] of runs) {
  const run = spawnSync('pnpm', ['exec', 'oxlint', '-c', config, ...split, ...owned], { stdio: 'inherit', env });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) {
    process.exitCode = run.status ?? 1;
    break;
  }
}
