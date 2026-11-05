import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'

import { disagreement } from './api-grid.ts'
import { readFacts } from './facts.ts'

import type { FactCell } from './facts.ts'

// The gate between the two repos. The test suite can't reach api-server,
// so it proves the gate on real files and CI runs it on the real one.

const TOOL = fileURLToPath(new URL('api-grid.ts', import.meta.url))
const { cells } = readFacts(
  fileURLToPath(new URL('../facts.json', import.meta.url)),
)
const dragon = cells.find(c => c.slug === 'nine-dragon-stack')
assert.ok(dragon !== undefined)
/** The grid with Nine Dragon's cell open: the shape of the old bug */
const FREED: readonly FactCell[] = [
  ...cells.filter(c => c !== dragon),
  { ...dragon, plot: true },
]

function run(context: TestContext, api: readonly FactCell[]): number | null {
  const dir = mkdtempSync(join(tmpdir(), 'api-grid-'))
  context.after(() => {
    rmSync(dir, { recursive: true })
  })
  const file = join(dir, 'waitlist-grid.json')
  writeFileSync(file, JSON.stringify({ cells: api }))
  return spawnSync(process.execPath, [TOOL, file]).status
}

test('the check passes on the same grid, in any order', context => {
  assert.equal(run(context, cells.toReversed()), 0)
})

test('the check fails when api-server frees a shard', context => {
  assert.equal(run(context, FREED), 1)
})

test('a disagreement names both sides', () => {
  assert.equal(disagreement(cells, FREED).length, 2)
  assert.deepEqual(disagreement(cells, cells), [])
})
