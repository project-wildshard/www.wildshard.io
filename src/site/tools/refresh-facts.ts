// `pnpm site:facts`: rewrites the part of src/site/facts.json that @wildshard/format knows, so the refresh needs no game
// checkout: the cell size, the pitch, the memory caps and the schema's path count. The rest of the file is kept, and is
// hand-maintained: the road width, who sits on which grid cell and the template's shard.json excerpt (docs/dev.md,
// "Refreshing the site's facts"). It stops if a hand-maintained part no longer fits the format.
// The site's build doesn't run this and never reads the format: only this tool and its test do.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { installFormatHook } from './format-hook.ts'
import { schemaPathCount } from './schema-paths.ts'

export interface FormatFacts {
  readonly cellSize: number
  readonly pitch: number
  readonly cellCount: number
  readonly explorerMB: number
  readonly loadingMB: number
  readonly schemaPaths: number
  readonly shardfileVersion: string
}

const DOC =
  "The site's facts: the site reads only this file. `pnpm site:facts` writes grid.cellSize, grid.pitch, memory and schemaPaths from @wildshard/format. grid.road, grid.cells and shardfile are hand-maintained (docs/dev.md)."
export const FACTS_FILE = fileURLToPath(
  new URL('../facts.json', import.meta.url),
)

/** The facts as @wildshard/format states them. A static import would link before the hook exists. */
export async function readFormat(): Promise<FormatFacts> {
  installFormatHook()
  const { CHUNK_SIZE, CONTENT_CAPS, GRID_CELL_COUNT, MEMORY_GATES } =
    await import('@wildshard/format/contentBounds')
  const { ShardfileSchema } = await import('@wildshard/format/shardSchema')
  const { SHARDFILE_VERSION } = await import('@wildshard/format/version')
  return {
    cellSize: CHUNK_SIZE,
    pitch: CONTENT_CAPS.pitch,
    cellCount: GRID_CELL_COUNT,
    explorerMB: MEMORY_GATES.explorerMB,
    loadingMB: MEMORY_GATES.loadingMB,
    schemaPaths: schemaPathCount(ShardfileSchema),
    shardfileVersion: SHARDFILE_VERSION,
  }
}

interface RawFacts {
  readonly grid: { readonly cells: readonly unknown[] }
  readonly shardfile: { readonly version: unknown }
}

export function readRaw(file: string): RawFacts {
  return JSON.parse(readFileSync(file, 'utf8')) as RawFacts
}

/** The facts file with the format's numbers written in, keys in place */
export function refreshed(raw: RawFacts, format: FormatFacts): RawFacts {
  if (raw.grid.cells.length !== format.cellCount) {
    throw new Error(
      `site facts: ${raw.grid.cells.length} grid cells, but the format's grid has ${format.cellCount}`,
    )
  }
  if (raw.shardfile.version !== format.shardfileVersion) {
    throw new Error(
      `site facts: the shardfile excerpt is version ${String(raw.shardfile.version)}, but the format is ${format.shardfileVersion}: update it by hand`,
    )
  }
  return {
    ...raw,
    $doc: DOC,
    grid: { ...raw.grid, cellSize: format.cellSize, pitch: format.pitch },
    memory: { explorerMB: format.explorerMB, loadingMB: format.loadingMB },
    schemaPaths: format.schemaPaths,
  } as RawFacts
}

export function factsText(raw: RawFacts): string {
  return `${JSON.stringify(raw, null, 2)}\n`
}

if (import.meta.main) {
  writeFileSync(
    FACTS_FILE,
    factsText(refreshed(readRaw(FACTS_FILE), await readFormat())),
  )
  console.info(`site facts: wrote ${FACTS_FILE}`)
}
