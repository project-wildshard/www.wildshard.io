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
  readFormat,
  readRaw,
  refreshed,
} from './refresh-facts.ts'
import { schemaPathCount } from './schema-paths.ts'

// The committed facts against the pinned @wildshard/format: a format bump that
// moves a number fails here until `pnpm site:facts` rewrites it.

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
  const stale = { ...raw, schemaPaths: 1, memory: { explorerMB: 1 } }

  const next = factsText(refreshed(stale, format))

  assert.equal(next, readFileSync(FACTS_FILE, 'utf8'))
})

test('a refresh stops when the hand-maintained parts no longer fit', () => {
  const short = { ...raw, grid: { cells: [] } }
  const oldShard = { ...raw, shardfile: { version: '0.0' } }

  assert.throws(() => refreshed(short, format), /0 grid cells/u)
  assert.throws(() => refreshed(oldShard, format), /update it by hand/u)
})

test('no two shards share a cell', () => {
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
