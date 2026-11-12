// Whether a push to main redeploys wildshard.io (site-deploy.yml's `changes` job). Kit syncs, lint config and other
// tooling commits must not ship the site, so a push deploys only when what the site's build reads changed:
//   - a file under src/site/ other than a test, the README or this file (deploy.sh exports that folder alone and builds it);
//   - in package.json, only the fields the deploy reads (SITE_PACKAGE_FIELDS): node and pnpm versions, the module
//     type, the pinned vite, pnpm overrides and patches, and the site:deploy:cf script. A whole-file diff would deploy on every kit sync.
// Not deploying, on purpose: pnpm-lock.yaml alone (vite is pinned exactly in package.json, so a vite bump shows there),
// scripts/vite-tmp.mjs (the kit's temp redirect; it changes no output) and the workflow itself. ci builds the site
// on every push, so a toolchain change that breaks the build fails there; ship one with
// `gh workflow run site-deploy.yml --ref main`.
//
//   node src/site/tools/deploy-gate.ts <before-sha> <after-sha>   # prints deploy=true|false and the reason

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

/** The package.json fields the site's build and upload read; any other field is tooling */
export const SITE_PACKAGE_FIELDS: readonly (readonly string[])[] = [
  ['packageManager'],
  ['engines'],
  ['type'],
  ['devDependencies', 'vite'],
  ['scripts', 'site:deploy:cf'],
  ['pnpm', 'overrides'],
  ['pnpm', 'patchedDependencies'],
]

/** A changed path the site's build reads: src/site/ minus tests, the README and this gate (the workflow's paths) */
export function isSiteFile(path: string): boolean {
  return (
    path.startsWith('src/site/') &&
    !path.endsWith('.test.ts') &&
    path !== 'src/site/README.md' &&
    path !== 'src/site/tools/deploy-gate.ts'
  )
}

function pick(value: unknown, keys: readonly string[]): unknown {
  let at = value
  for (const k of keys) {
    if (typeof at !== 'object' || at === null) {
      return undefined
    }
    at = Object.entries(at).find(([name]) => name === k)?.[1]
  }
  return at
}

/** The package.json fields in SITE_PACKAGE_FIELDS whose values differ between two package.json texts */
export function sitePackageChanges(before: string, after: string): string[] {
  const a: unknown = JSON.parse(before)
  const b: unknown = JSON.parse(after)
  return SITE_PACKAGE_FIELDS.filter(
    keys => JSON.stringify(pick(a, keys)) !== JSON.stringify(pick(b, keys)),
  ).map(keys => keys.join('.'))
}

export interface Gate {
  deploy: boolean
  reason: string
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

function hasCommit(cwd: string, sha: string): boolean {
  try {
    git(cwd, ['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch {
    return false
  }
}

function packageAt(cwd: string, sha: string): string | null {
  try {
    return git(cwd, ['show', `${sha}:package.json`])
  } catch {
    return null
  }
}

/** The decision for the push before..after in the checkout at cwd; with no usable base it deploys */
export function decide(cwd: string, before: string, after: string): Gate {
  if (/^0+$/u.test(before) || !hasCommit(cwd, before)) {
    return { deploy: true, reason: `no base commit ${before} to compare` }
  }
  // --no-renames: a file moved out of src/site/ is a site change, and only its old path says so
  const files = git(cwd, ['diff', '--no-renames', '--name-only', before, after])
    .split('\n')
    .filter(f => f !== '')
  const site = files.filter(f => isSiteFile(f))
  if (site.length > 0) {
    return { deploy: true, reason: `site files changed: ${site.join(', ')}` }
  }
  if (files.includes('package.json')) {
    const a = packageAt(cwd, before)
    const b = packageAt(cwd, after)
    const fields =
      a === null || b === null ? ['package.json'] : sitePackageChanges(a, b)
    if (fields.length > 0) {
      return {
        deploy: true,
        reason: `site build fields changed: ${fields.join(', ')}`,
      }
    }
  }
  return {
    deploy: false,
    reason: `no site input changed (${files.length} tooling files)`,
  }
}

if (import.meta.main) {
  const [before, after] = process.argv.slice(2)
  if (before === undefined || after === undefined) {
    throw new Error(
      'usage: node src/site/tools/deploy-gate.ts <before> <after>',
    )
  }
  const gate = decide(process.cwd(), before, after)
  console.log(`deploy=${gate.deploy}: ${gate.reason}`)
  const out = process.env.GITHUB_OUTPUT
  if (out !== undefined && out !== '') {
    appendFileSync(out, `deploy=${gate.deploy}\n`)
  }
}
