import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseCopy } from './copy.ts'
import { journeyDate, readFacts } from './facts.ts'
import { FACTS_FILE, readRaw } from './refresh-facts.ts'

// Meta WWW-REFRESH WW6: every date on the journey is a fact in facts.json's timeline, with its source beside it.

const COPY_FILE = fileURLToPath(new URL('../COPY.md', import.meta.url))

test('a journey date is a day, or a run of days in one month', () => {
  assert.equal(journeyDate('2026-10-01'), '1 Oct 2026')
  assert.equal(journeyDate('2026-09-16', '2026-09-18'), '16–18 Sep 2026')
  assert.throws(() => journeyDate('Oct 1'), /YYYY-MM-DD/u)
})

test('every journey date in COPY.md is a timeline fact with a source', () => {
  const copy = parseCopy(readFileSync(COPY_FILE, 'utf8'))
  const raw = readRaw(FACTS_FILE) as unknown as {
    timeline: { entries: Record<string, { source?: string }> }
  }
  const dates = [...copy].filter(([key]) => /^Journey · \d+ date$/u.test(key))
  assert.ok(dates.length > 0)
  for (const [key, text] of dates) {
    const id = /^\{=date(?<id>\w+)\}$/u.exec(text)?.groups?.id
    assert.ok(id !== undefined, `${key} is "${text}", not a {=date<Id>} fact`)
    assert.ok(
      raw.timeline.entries[id]?.source,
      `${key}: timeline entry ${id} has no source`,
    )
  }
  assert.equal(readFacts(FACTS_FILE).text.weeksWord, 'ten')
})
