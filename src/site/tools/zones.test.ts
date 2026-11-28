import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseCopy } from './copy.ts'
import { readFacts } from './facts.ts'
import { FACTS_FILE } from './refresh-facts.ts'
import { MAP_LABEL } from './zones.ts'

// Meta WWW-REFRESH WW1: the site names exactly the zones on the live grid, no more and no fewer.

const COPY_FILE = fileURLToPath(new URL('../COPY.md', import.meta.url))
const facts = readFacts(FACTS_FILE)
const zones = facts.cells.filter(c => !c.plot).map(c => c.slug)

test('every zone on the grid has a map label, and every label a zone', () => {
  assert.deepEqual(zones.toSorted(), Object.keys(MAP_LABEL).toSorted())
})

test("every map label's text is in COPY.md", () => {
  const copy = parseCopy(readFileSync(COPY_FILE, 'utf8'))
  for (const key of Object.values(MAP_LABEL)) {
    assert.ok(copy.has(key), `COPY.md has no ## ${key}`)
  }
})

test('the grid holds ten zones and fifteen open plots, each with a name', () => {
  assert.equal(zones.length, 10)
  assert.equal(facts.cells.length - zones.length, 15)
  for (const c of facts.cells) assert.ok(facts.names[c.slug], c.slug)
})

// WW4: home shows one card per zone, and each card's Play link opens that zone by its share link (engine
// src/client/app/slug-path.ts); open plots are never featured as content.
test('home has one card per zone, each playing its own /slug/ link', () => {
  const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const cards = [
    ...home.matchAll(/<li class="shard[^"]*" data-cell="(?<slug>[^"]+)">/gu),
  ].map(m => m.groups?.slug ?? '')
  assert.deepEqual(
    cards.toSorted((a, b) => a.localeCompare(b)),
    zones.toSorted((a, b) => a.localeCompare(b)),
  )
  for (const slug of zones) {
    assert.ok(
      home.includes(`href="%PLAY_URL%slug/${slug}"`),
      `no Play link for ${slug}`,
    )
  }
})
