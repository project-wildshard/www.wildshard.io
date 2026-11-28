// Meta WWW-REFRESH WW15: deploy.sh builds from an export of HEAD, not this checkout. From 2026-11-25 to 11-27 every
// deploy failed because vite.config.ts imported src/scripts/.kit/vite-tmp.mjs and the export held src/site/ alone.
// This test fails when vite.config.ts imports a file outside src/site/ that deploy.sh's EXPORT leaves out.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SITE = fileURLToPath(new URL('..', import.meta.url))
const REPO = resolve(SITE, '../..')

function exported(): readonly string[] {
  const script = readFileSync(resolve(SITE, 'tools/deploy.sh'), 'utf8')
  const line = /^EXPORT=\((?<paths>[^)]*)\)$/mu.exec(script)
  const paths = line?.groups?.paths
  assert.ok(paths !== undefined, 'deploy.sh has an EXPORT=(...) line')
  return paths.split(/\s+/u).filter(Boolean)
}

function outsideImports(): readonly string[] {
  const config = readFileSync(resolve(SITE, 'vite.config.ts'), 'utf8')
  const found: string[] = []
  for (const match of config.matchAll(
    /^import [^'"]*['"](?<from>\.\.\/[^'"]+)['"]/gmu,
  )) {
    const from = match.groups?.from
    if (from !== undefined) found.push(relative(REPO, resolve(SITE, from)))
  }
  return found
}

test('every file vite.config.ts imports from outside src/site/ is in the deploy export', () => {
  const paths = exported()
  assert.ok(paths.includes('src/site'), 'the export holds src/site')
  const missing = outsideImports().filter(
    file => !paths.some(p => file === p || file.startsWith(`${p}/`)),
  )
  assert.deepEqual(missing, [])
})

test('the check sees the kit import today', () => {
  assert.ok(outsideImports().includes('src/scripts/.kit/vite-tmp.mjs'))
})
