// The site's numbers (E506 RD14, MR11 / MR12: "hand-copied numbers rot within days"), read from src/site/facts.json:
// the one facts file, committed here. tools/refresh-facts.ts writes what @wildshard/format knows; docs/dev.md says what
// stays hand-maintained. The site reads nothing else. A plain module: no plugin,
// no new dependency. This file turns the raw numbers into the words COPY.md shows.
//   readFacts(file)      what src/site/vite.config.ts does
// COPY.md says {=name} where a number belongs (src/site/tools/copy.ts fills it); the grid pictures read `cells`; the
// shardfile peek (MS15) reads `shardfile`, an excerpt of the template's built shard.json.
import { readFileSync } from 'node:fs'

/** One cell of the grid the site draws: a shard, or an open plot waiting for an author */
export interface FactCell {
  readonly x: number
  readonly z: number
  readonly slug: string
  readonly plot: boolean
}
export interface SiteFacts {
  readonly text: Readonly<Record<string, string>>
  readonly cells: readonly FactCell[]
  readonly shardfile: Readonly<Record<string, unknown>>
}

const FORMAT = 'wildshard-site-facts/1'
const num = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]

function record(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`site facts: ${what} is not a JSON object`)
  }
  return Object.fromEntries(Object.entries(v))
}
function list(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new Error(`site facts: ${what} is not a JSON array`)
  }
  return v
}
function number(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`site facts: ${what} is not a number`)
  }
  return v
}

export function readFacts(file: string): SiteFacts {
  const raw = record(JSON.parse(readFileSync(file, 'utf8')), file)
  if (raw.format !== FORMAT) {
    throw new Error(
      `site facts: ${file} is not ${FORMAT} (format ${String(raw.format)})`,
    )
  }
  const grid = record(raw.grid, 'grid'),
    memory = record(raw.memory, 'memory')
  const cells: FactCell[] = list(grid.cells, 'grid.cells').map(c => {
    const f = record(c, 'a grid cell')
    if (typeof f.slug !== 'string' || typeof f.plot !== 'boolean') {
      throw new Error('site facts: a grid cell has no slug / plot')
    }
    return {
      x: number(f.x, 'cell x'),
      z: number(f.z, 'cell z'),
      slug: f.slug,
      plot: f.plot,
    }
  })
  const side = Math.round(Math.sqrt(cells.length))
  if (side * side !== cells.length) {
    throw new Error(`site facts: ${cells.length} grid cells is not a square`)
  }
  const size = number(grid.cellSize, 'grid.cellSize'),
    pitch = number(grid.pitch, 'grid.pitch'),
    road = number(grid.road, 'grid.road')
  const gap = pitch - size,
    shards = cells.filter(c => !c.plot).length,
    plots = cells.length - shards
  const gb = (mb: number): string => `${num(mb / 1000)} GB`
  const text: Record<string, string> = {
    side: String(side), // 5 (a 5 × 5)
    cells: String(cells.length), // 25
    cellSize: num(size), // 500 (m)
    pitch: num(pitch), // 562.5 (m, centre to centre)
    gap: num(gap), // 62.5 (m round each cell)
    road: num(road), // 15 (m of road in the gap)
    verge: num((gap - road) / 2), // 23.75 (m either side of the road)
    corner: num(Math.round(gap / Math.SQRT2)), // 44 (m: the crossroads' four corners from its centre)
    shards: String(shards),
    shardsWord: WORDS[shards] ?? String(shards),
    plots: String(plots),
    memoryPlaying: gb(number(memory.explorerMB, 'memory.explorerMB')), // 1.2 GB a shard (Jake, G534 / G556)
    memoryLoading: gb(number(memory.loadingMB, 'memory.loadingMB')),
    schemaPaths: num(number(raw.schemaPaths, 'schemaPaths')),
  }
  return { text, cells, shardfile: record(raw.shardfile, 'shardfile') }
}

/** COPY.md text with every {=name} replaced; an unknown name stops the build */
export function fillFacts(s: string, facts: SiteFacts): string {
  return s.replaceAll(/\{=(\w+)\}/gu, (_m, name: string) => {
    const v = facts.text[name]
    if (v === undefined) {
      throw new Error(
        `src/site/COPY.md: no site fact {=${name}} (src/site/tools/facts.ts)`,
      )
    }
    return v
  })
}
