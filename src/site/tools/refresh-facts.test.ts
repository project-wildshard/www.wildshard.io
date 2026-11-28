import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  array,
  check,
  minLength,
  nullable,
  number,
  optional,
  pipe,
  strictObject,
  string,
  trim,
  union,
  unknown,
} from 'valibot'

import { cellName } from './claim-grid.ts'
import { readFacts } from './facts.ts'
import {
  FACTS_FILE,
  factsText,
  gridFromCatalogue,
  readFormat,
  readRaw,
  refreshed,
} from './refresh-facts.ts'
import { schemaPathCount } from './schema-paths.ts'

// The committed facts against the pinned @wildshard/format: a format bump that
// moves a number fails here until `pnpm site:facts` rewrites it. The grid comes
// from the live catalogue, which tests never reach: these keep the committed one.

const format = await readFormat()
const raw = readRaw(FACTS_FILE)

test('facts.json holds what the pinned format says', () => {
  assert.equal(
    factsText(refreshed(raw, format)),
    readFileSync(FACTS_FILE, 'utf8'),
    'stale: run pnpm site:facts',
  )
})

test('a refresh replaces the numbers and keeps the hand-maintained parts', () => {
  const stale = { ...raw, schemaPaths: 1, download: { fineMB: 1 } }

  const next = factsText(refreshed(stale, format))

  assert.equal(next, readFileSync(FACTS_FILE, 'utf8'))
})

test('a refresh stops on a cell off the grid or a slug with no name', () => {
  const far = gridFromCatalogue([
    { slug: 'glowfen', name: 'Glowfen', grid: { column: 9, row: 0 } },
  ])
  const nameless = { ...raw, names: {} }

  assert.throws(() => refreshed(raw, format, far), /off the format's grid/u)
  assert.throws(() => refreshed(nameless, format), /has no name/u)
})

test('the catalogue becomes cells: column is x, row is z, open plots are plots', () => {
  const grid = gridFromCatalogue([
    {
      slug: 'driftwood-isle',
      name: 'Driftwood Isle',
      grid: { column: 0, row: 0 },
    },
    {
      slug: 'open-plot-coral-drift',
      name: 'Open Plot · Coral Drift',
      grid: { column: 1, row: -2 },
    },
    { slug: 'open-plot-thin-ice', name: 'Open Plot · Thin Ice', grid: null },
  ])

  assert.deepEqual(grid.cells, [
    { x: 0, z: 0, slug: 'driftwood-isle', plot: false },
    { x: 1, z: -2, slug: 'open-plot-coral-drift', plot: true },
  ])
  assert.deepEqual(Object.keys(grid.names), [
    'driftwood-isle',
    'open-plot-coral-drift',
  ])
})

test('no two zones share a cell', () => {
  const { cells } = readFacts(FACTS_FILE)

  assert.equal(new Set(cells.map(c => cellName(c))).size, cells.length)
})

test('schema paths count every declared path, through wrappers and pipes', () => {
  const schema = strictObject({
    name: pipe(string(), minLength(1)),
    tags: optional(array(number())),
    pick: nullable(union([string(), number()])),
  })

  assert.equal(schemaPathCount(schema), 7)
  assert.equal(schemaPathCount(pipe(unknown(), check(Boolean), schema)), 7)
})

test('a schema the walk does not know stops it', () => {
  assert.throws(
    () => schemaPathCount({ kind: 'schema', type: 'mystery' }),
    /unknown schema at \$: mystery/u,
  )
  assert.throws(
    () => schemaPathCount(pipe(string(), trim())),
    /unknown action at \$: trim/u,
  )
})
