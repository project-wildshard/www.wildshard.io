import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  buildGridHtml,
  cellName,
  claimGridHtml,
  takenCells,
} from './claim-grid.ts'
import { readFacts } from './facts.ts'

import type { FactCell } from './facts.ts'

// The claim maps against the committed facts. The literal lists are the
// bug this file exists for: the form had Driftwood on B2, offered Nine
// Dragon's D4 and refused the open plots B2 and B4.

const site = new URL('../', import.meta.url)
const { cells } = readFacts(new URL('facts.json', site).pathname)
const TAKEN = ['C2', 'D2', 'B3', 'C3', 'D3', 'C4', 'D4']
const label = (c: FactCell): string => `{{${c.slug}}}`
const shardOn = (name: string): string | undefined =>
  cells.find(c => cellName(c) === name)?.slug

function radios(html: string): readonly string[] {
  return [...html.matchAll(/value="(?<cell>[A-E][1-5])"/gu)].map(
    m => m.groups?.cell ?? '',
  )
}

test('cells are named west to east, north to south', () => {
  assert.equal(cellName({ x: -2, z: 2 }), 'A1')
  assert.equal(cellName({ x: 0, z: 0 }), 'C3')
  assert.equal(cellName({ x: 1, z: -1 }), 'D4')
  assert.equal(cellName({ x: 2, z: -2 }), 'E5')
  assert.throws(() => cellName({ x: 3, z: 0 }), /off the 5 × 5/u)
})

test('the shards sit where the facts put them', () => {
  assert.deepEqual(takenCells(cells), TAKEN)
  assert.equal(shardOn('C3'), 'driftwood-isle')
  assert.equal(shardOn('D4'), 'nine-dragon-stack')
})

test('the form offers every open plot and no shard', () => {
  const html = claimGridHtml(cells, label)
  const offered = radios(html)

  assert.equal(offered.length + TAKEN.length, cells.length)
  assert.deepEqual(
    offered.filter(cell => TAKEN.includes(cell)),
    [],
  )
  assert.ok(offered.includes('B2'))
  assert.ok(offered.includes('B4'))
  assert.ok(!offered.includes('D4'))
  assert.match(html, /<i>C3<\/i><b>\{\{driftwood-isle\}\}/u)
  assert.match(html, /<i>D4<\/i><b>\{\{nine-dragon-stack\}\}/u)
})

test('/build draws the same map, with one open plot marked yours', () => {
  const html = buildGridHtml(cells, label)

  assert.deepEqual(
    [...html.matchAll(/taken"><i>(?<cell>[A-E][1-5])/gu)].map(
      m => m.groups?.cell,
    ),
    TAKEN,
  )
  assert.match(html, /b-yours"><i>E3<\/i>/u)
  const shardOnE3: FactCell = { x: 2, z: 0, slug: 'a-shard', plot: false }
  assert.throws(() => buildGridHtml([shardOnE3], label), /offers E3/u)
})

test('no page keeps a hand-written grid', () => {
  for (const [page, marker] of [
    ['index.html', '<!--gen:claimgrid-->'],
    ['build/index.html', '<!--gen:buildgrid-->'],
  ] as const) {
    const html = readFileSync(new URL(page, site), 'utf8')
    assert.ok(html.includes(marker), page)
    assert.doesNotMatch(html, /class="cell[ "]/u, page)
  }
})
