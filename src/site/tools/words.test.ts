import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseCopy } from './copy.ts'
import { retiredWords } from './words.ts'

// Meta WWW-REFRESH WW2: no retired word reaches a page. The copy rows (WW3 to WW13) remove them page by page; until
// WW15 makes enforcing the default, the gate prints what is left and passes (SITE_WORDS=enforce runs it now).
const ENFORCE = process.env.SITE_WORDS === 'enforce'
const COPY_FILE = fileURLToPath(new URL('../COPY.md', import.meta.url))

test('the check finds each retired word and keeps the allowed ones', () => {
  const copy = new Map([
    ['a', 'Ten shards. A single-player alpha, Shard Select.'],
    [
      'b',
      'Wildshard, a shardfile, shard.json, shard-driftwood and @wildshard/sdk.',
    ],
    ['c', 'open it with ?chunk=3 on revision 2'],
  ])

  const found = retiredWords(copy).map(h => `${h.key}:${h.found}`)

  assert.deepEqual(found, [
    'a:shards',
    'a:Shard',
    'a:single-player alpha',
    'a:Shard Select',
    'c:revision',
    'c:?chunk=',
  ])
})

test('COPY.md uses no retired word', () => {
  const hits = retiredWords(parseCopy(readFileSync(COPY_FILE, 'utf8')))
  if (!ENFORCE) {
    const keys = new Set(hits.map(h => h.key))
    console.info(
      `site words: ${hits.length} retired words left under ${keys.size} headings (WW15 enforces)`,
    )
    return
  }
  assert.deepEqual(
    hits.map(h => `${h.key}: "${h.found}" → ${h.instead}`),
    [],
  )
})
