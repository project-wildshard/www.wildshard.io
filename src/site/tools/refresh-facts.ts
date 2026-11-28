// `pnpm site:facts`: rewrites what src/site/facts.json takes from a source, so the site never hand-copies a number
// (meta WWW-REFRESH WW1). Two sources, no game checkout:
//   @wildshard/format            the cell size, pitch and road, the grid's radius, the download tiers, the schema's paths
//   api.wildshard.io/api/catalogue  who sits on which cell of the live grid, and each zone's name
// The rest is kept by hand, each with its source named beside it: the memory lines and seats (`mmo`), the shardfile
// excerpt, the timeline (docs/dev.md, "Refreshing the site's facts"). The site's build never runs this and never reads
// the format or the API: only this tool and its test do. `--offline` skips the API and keeps the committed grid.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { installFormatHook } from './format-hook.ts'
import { schemaPathCount } from './schema-paths.ts'

import type { FactCell } from './facts.ts'

export interface FormatFacts {
  readonly cellSize: number
  readonly pitch: number
  readonly road: number
  readonly gridRadius: number
  readonly downloadFineBytes: number
  readonly downloadHardBytes: number
  readonly schemaPaths: number
  readonly shardfileVersion: string
}

/** The live grid: who sits on which cell, and every slug's display name */
export interface LiveGrid {
  readonly cells: readonly FactCell[]
  readonly names: Readonly<Record<string, string>>
}

const DOC =
  "The site's facts: the site reads only this file. `pnpm site:facts` writes grid (cells from api.wildshard.io's catalogue; cellSize, pitch, road from @wildshard/format), names, download and schemaPaths. mmo, shardfile and timeline are kept by hand, each with its source (docs/dev.md)."
export const FACTS_FILE = fileURLToPath(
  new URL('../facts.json', import.meta.url),
)
export const API = 'https://api.wildshard.io'
/** The Wildshard agent marker (engine src/shared/engine/app/actor.ts): automation names itself to production */
const AGENT_UA = 'WildshardAgent/1 (www-site-facts)'
const OPEN_PLOT = 'open-plot-'

/** The facts as @wildshard/format states them. A static import would link before the hook exists. */
export async function readFormat(): Promise<FormatFacts> {
  installFormatHook()
  const { CHUNK_SIZE, CONTENT_CAPS, GRID_RADIUS, ROAD_WIDTH } =
    await import('@wildshard/format/contentBounds')
  const { BUDGET_TIERS } = await import('@wildshard/format/budget-tiers')
  const { ShardfileSchema } = await import('@wildshard/format/shardSchema')
  const { SHARDFILE_VERSION } = await import('@wildshard/format/version')
  return {
    cellSize: CHUNK_SIZE,
    pitch: CONTENT_CAPS.pitch,
    road: ROAD_WIDTH,
    gridRadius: GRID_RADIUS,
    // J338: 50 MB is fine and 100 MB is the hard cap; the format's medium and large tiers are those two lines
    downloadFineBytes: BUDGET_TIERS.medium.bandwidthBytes,
    downloadHardBytes: BUDGET_TIERS.large.bandwidthBytes,
    schemaPaths: schemaPathCount(ShardfileSchema),
    shardfileVersion: SHARDFILE_VERSION,
  }
}

interface CatalogueShard {
  readonly slug: string
  readonly name?: string
  readonly grid?: { readonly column: number; readonly row: number } | null
}

/** The catalogue's placed shards as grid cells: x is the column (east), z the row (north) */
export function gridFromCatalogue(shards: readonly CatalogueShard[]): LiveGrid {
  const cells: FactCell[] = [],
    names: Record<string, string> = {}
  for (const s of shards) {
    const at = s.grid
    if (at !== undefined && at !== null) {
      cells.push({
        x: at.column,
        z: at.row,
        slug: s.slug,
        plot: s.slug.startsWith(OPEN_PLOT),
      })
      names[s.slug] = s.name ?? s.slug
    }
  }
  cells.sort((a, b) => b.z - a.z || a.x - b.x)
  return {
    cells,
    names: Object.fromEntries(
      Object.entries(names).toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  }
}

/** The live grid from the API's catalogue */
export async function readGrid(api: string = API): Promise<LiveGrid> {
  const res = await fetch(`${api}/api/catalogue`, {
    headers: { 'user-agent': AGENT_UA },
  })
  if (!res.ok) {
    throw new Error(`site facts: ${api}/api/catalogue answered ${res.status}`)
  }
  const body = (await res.json()) as { shards?: CatalogueShard[] }
  if (!Array.isArray(body.shards)) {
    throw new Error(`site facts: ${api}/api/catalogue has no shards list`)
  }
  return gridFromCatalogue(body.shards)
}

interface RawFacts {
  readonly grid: { readonly cells: readonly FactCell[] }
  readonly names?: Readonly<Record<string, string>>
}

export function readRaw(file: string): RawFacts {
  return JSON.parse(readFileSync(file, 'utf8')) as RawFacts
}

/** The facts file with the sources' numbers written in, keys in place; `grid` absent keeps the committed cells */
export function refreshed(
  raw: RawFacts,
  format: FormatFacts,
  grid?: LiveGrid,
): RawFacts {
  const cells = grid?.cells ?? raw.grid.cells
  for (const c of cells) {
    if (
      Math.abs(c.x) > format.gridRadius ||
      Math.abs(c.z) > format.gridRadius
    ) {
      throw new Error(
        `site facts: ${c.slug} sits at (${c.x}, ${c.z}), off the format's grid of radius ${format.gridRadius}`,
      )
    }
  }
  const names = grid?.names ?? raw.names ?? {}
  for (const c of cells) {
    if (names[c.slug] === undefined) {
      throw new Error(`site facts: ${c.slug} has no name`)
    }
  }
  return {
    ...raw,
    $doc: DOC,
    grid: {
      ...raw.grid,
      cellSize: format.cellSize,
      pitch: format.pitch,
      road: format.road,
      cells,
    },
    names,
    download: {
      fineMB: format.downloadFineBytes / 1_000_000,
      hardMB: format.downloadHardBytes / 1_000_000,
    },
    schemaPaths: format.schemaPaths,
  } as RawFacts
}

export function factsText(raw: RawFacts): string {
  return `${JSON.stringify(raw, null, 2)}\n`
}

if (import.meta.main) {
  const offline = process.argv.includes('--offline')
  const grid = offline ? undefined : await readGrid()
  writeFileSync(
    FACTS_FILE,
    factsText(refreshed(readRaw(FACTS_FILE), await readFormat(), grid)),
  )
  console.info(
    `site facts: wrote ${FACTS_FILE}${offline ? ' (offline: grid kept)' : ` (${grid?.cells.length ?? 0} cells from ${API})`}`,
  )
}
