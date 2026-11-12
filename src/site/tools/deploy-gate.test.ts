import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { decide, isSiteFile, sitePackageChanges } from './deploy-gate.ts'

// Which pushes to main redeploy wildshard.io (meta HOW-WE-BUILD WWW1): tooling commits must not.

const REPO = join(import.meta.dirname, '..', '..', '..')
const WORKFLOW = readFileSync(
  join(REPO, '.github', 'workflows', 'site-deploy.yml'),
  'utf8',
)

const PKG = {
  name: 'site',
  type: 'module',
  packageManager: 'pnpm@10.34.9',
  engines: { node: '>=24.18.0' },
  scripts: { lint: 'oxlint', 'site:deploy:cf': 'wrangler deploy' },
  devDependencies: { oxlint: '1.89.0', vite: '8.3.0' },
}
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`

test('tooling-only package.json edits are not site changes', () => {
  const lint = { ...PKG, scripts: { ...PKG.scripts, lint: 'oxlint --x' } }
  const dep = {
    ...PKG,
    devDependencies: { ...PKG.devDependencies, oxlint: '1.90.0' },
  }
  assert.deepEqual(sitePackageChanges(json(PKG), json(lint)), [])
  assert.deepEqual(sitePackageChanges(json(PKG), json(dep)), [])
})

test('a vite, node or deploy-script edit is a site change', () => {
  const vite = {
    ...PKG,
    devDependencies: { ...PKG.devDependencies, vite: '8.4.0' },
  }
  const node = { ...PKG, engines: { node: '>=26' } }
  const cf = { ...PKG, scripts: { ...PKG.scripts, 'site:deploy:cf': 'x' } }
  assert.deepEqual(sitePackageChanges(json(PKG), json(vite)), [
    'devDependencies.vite',
  ])
  assert.deepEqual(sitePackageChanges(json(PKG), json(node)), ['engines'])
  assert.deepEqual(sitePackageChanges(json(PKG), json(cf)), [
    'scripts.site:deploy:cf',
  ])
})

test('site files are src/site/ minus tests and the README', () => {
  assert.ok(isSiteFile('src/site/COPY.md'))
  assert.ok(isSiteFile('src/site/public/media/a.webp'))
  assert.ok(isSiteFile('src/site/tools/copy.ts'))
  assert.ok(!isSiteFile('src/site/tools/copy.test.ts'))
  assert.ok(!isSiteFile('src/site/README.md'))
  assert.ok(!isSiteFile('src/site/tools/deploy-gate.ts'))
  assert.ok(!isSiteFile('scripts/vite-tmp.mjs'))
  assert.ok(!isSiteFile('pnpm-lock.yaml'))
  assert.ok(!isSiteFile('.github/workflows/site-deploy.yml'))
})

// Scratch repos go in the repo's tmp/, never the system temp dir (meta TEMP-HYGIENE)
mkdirSync(join(REPO, 'tmp'), { recursive: true })
const work = mkdtempSync(join(REPO, 'tmp', 'deploy-gate-'))
after(() => {
  rmSync(work, { recursive: true, force: true })
})
const git = (...args: string[]): string =>
  execFileSync('git', ['-C', work, ...args], { encoding: 'utf8' }).trim()
function commit(files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true })
    writeFileSync(join(work, path), text)
  }
  git('add', '--', ...Object.keys(files))
  const id = ['-c', 'user.name=t', '-c', 'user.email=t@t']
  const quiet = ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
  git(...id, ...quiet, 'commit', '-qm', 'c')
  return git('rev-parse', 'HEAD')
}
git('init', '-q')
const base = commit({
  'package.json': json(PKG),
  'src/site/COPY.md': '# copy\n',
})

test('a push decides over all its commits', () => {
  const kit = commit({
    'scripts/vite-tmp.mjs': '//\n',
    'pnpm-lock.yaml': 'x\n',
    '.github/workflows/site-deploy.yml': 'x\n',
    'src/site/tools/copy.test.ts': '//\n',
    'package.json': json({ ...PKG, scripts: { ...PKG.scripts, lint: 'y' } }),
  })
  assert.equal(decide(work, base, kit).deploy, false)
  const copy = commit({ 'src/site/COPY.md': '# copy 2\n' })
  assert.equal(decide(work, kit, copy).deploy, true)
  assert.equal(decide(work, base, copy).deploy, true)
  const vite = commit({
    'package.json': json({
      ...PKG,
      devDependencies: { ...PKG.devDependencies, vite: '9.0.0' },
    }),
  })
  assert.equal(decide(work, copy, vite).deploy, true)
})

test('a file moved out of src/site/ is a site change', () => {
  const head = git('rev-parse', 'HEAD')
  renameSync(join(work, 'src/site/COPY.md'), join(work, 'COPY.md'))
  git('add', '--', 'src/site/COPY.md', 'COPY.md')
  const id = ['-c', 'user.name=t', '-c', 'user.email=t@t']
  const quiet = ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
  git(...id, ...quiet, 'commit', '-qm', 'move')
  assert.equal(decide(work, head, git('rev-parse', 'HEAD')).deploy, true)
})

test('no usable base deploys', () => {
  const head = git('rev-parse', 'HEAD')
  assert.equal(decide(work, '0'.repeat(40), head).deploy, true)
  assert.equal(decide(work, 'f'.repeat(40), head).deploy, true)
})

test('the workflow matches the gate and runs in the production environment', () => {
  const paths = WORKFLOW.slice(
    WORKFLOW.indexOf('    paths:\n'),
    WORKFLOW.indexOf('  workflow_dispatch:'),
  )
  assert.deepEqual(
    [...paths.matchAll(/- '([^']+)'/gu)].map(m => m[1]),
    [
      'src/site/**',
      '!src/site/**/*.test.ts',
      '!src/site/README.md',
      '!src/site/tools/deploy-gate.ts',
      'package.json',
    ],
  )
  const deploy = WORKFLOW.slice(WORKFLOW.indexOf('\n  deploy:\n'))
  assert.match(deploy, /\n {4}needs: changes\n/u)
  assert.match(deploy, /\n {4}environment: production\n/u)
  assert.match(
    deploy,
    /\n {4}if: github\.ref == 'refs\/heads\/main' && needs\.changes\.outputs\.deploy == 'true'\n/u,
  )
  assert.match(WORKFLOW, /deploy-gate\.ts "\$BEFORE" "\$AFTER"/u)
})
