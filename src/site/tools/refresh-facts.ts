// `pnpm site:facts`: rewrites what src/site/facts.json takes from a source, so the site never hand-copies a number
// (meta WWW-REFRESH WW1). Two sources, no game checkout:
//   @wildshard/format            the cell size, pitch and road, the grid's radius, the download tiers, the schema's paths
//   api.wildshard.io/api/catalogue  who sits on which cell of the live grid, and each zone's name; then the template
//                                  zone's live shardfile, for the shard.json excerpt (WW5; J507: read by slug)
// The rest is kept by hand, each with its source named beside it: the memory lines and seats (`mmo`), the timeline
// (docs/dev.md, "Refreshing the site's facts"). The site's build never runs this and never reads
// the format or the API: only this tool and its test do. `--offline` skips the API and keeps the committed grid.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync } from 'node:zlib'

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
  "The site's facts: the site reads only this file. `pnpm site:facts` writes grid (cells from api.wildshard.io's catalogue; cellSize, pitch, road from @wildshard/format), names, download, schemaPaths and shardfile (the template zone's live shard.json). mmo and timeline are kept by hand, each with its source (docs/dev.md)."
export const FACTS_FILE = fileURLToPath(
  new URL('../facts.json', import.meta.url),
)
export const API = 'https://api.wildshard.io'
/** The Wildshard agent marker (engine src/shared/engine/app/actor.ts): automation names itself to production */
const AGENT_UA = 'WildshardAgent/1 (www-site-facts)'
const OPEN_PLOT = 'open-plot-'
/** The zone whose shard.json the site shows: the template every new zone starts from (J434) */
export const EXCERPT_SLUG = 'mossgate'
const TAR_BLOCK = 512
const TAR_NAME = 100
const TAR_SIZE_AT = 124
const TAR_SIZE_END = 136
const OCTAL = 8
const TAR_MAGIC = 'ustar'
const TAR_MAGIC_AT = 257

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
  readonly live?: { readonly hash: string } | null
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

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': AGENT_UA } })
  if (!res.ok) {
    throw new Error(`site facts: ${url} answered ${res.status}`)
  }
  return res
}

/** The API's catalogue: every placed zone and open plot */
export async function readCatalogue(
  api: string = API,
): Promise<readonly CatalogueShard[]> {
  const res = await get(`${api}/api/catalogue`)
  const body = (await res.json()) as { shards?: CatalogueShard[] }
  if (!Array.isArray(body.shards)) {
    throw new Error(`site facts: ${api}/api/catalogue has no shards list`)
  }
  return body.shards
}

/** One file out of an uncompressed tar, by its path's ending */
export function tarFile(tar: Uint8Array, ending: string): Buffer | undefined {
  const b = Buffer.from(tar)
  const text = (from: number, to: number): string =>
    b.toString('latin1', from, to).replace(/\0.*$/su, '')
  for (let at = 0; at + TAR_BLOCK <= b.length && b[at] !== 0;) {
    const size =
      Number.parseInt(
        text(at + TAR_SIZE_AT, at + TAR_SIZE_END).trim(),
        OCTAL,
      ) || 0
    if (text(at, at + TAR_NAME).endsWith(ending)) {
      return b.subarray(at + TAR_BLOCK, at + TAR_BLOCK + size)
    }
    at += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }
  return undefined
}

interface ShardJson {
  readonly format?: string
  readonly shardVersion?: string
  readonly identity?: {
    readonly author?: string
    readonly name?: string
    readonly slug?: string
  }
  readonly requires?: { readonly engine?: string }
  readonly admission?: { readonly authorCaps?: unknown }
}

/** The few fields of a built shard.json the site shows, in the file's own words */
export function shardfileExcerpt(j: ShardJson): Record<string, unknown> {
  const { format, shardVersion, identity, requires, admission } = j
  if (
    format === undefined ||
    identity === undefined ||
    admission?.authorCaps === undefined
  ) {
    throw new Error(
      'site facts: the shard.json lacks format, identity or admission.authorCaps',
    )
  }
  return {
    format,
    shardVersion,
    identity: {
      author: identity.author,
      name: identity.name,
      slug: identity.slug,
    },
    requires: { engine: requires?.engine },
    admission: { authorCaps: admission.authorCaps },
  }
}

/** The template zone's live shard.json, from its shardfile on the API (a brotli tar) */
export async function readExcerpt(
  shards: readonly CatalogueShard[],
  api: string = API,
): Promise<Record<string, unknown>> {
  const hash = shards.find(s => s.slug === EXCERPT_SLUG)?.live?.hash
  if (hash === undefined) {
    throw new Error(
      `site facts: ${EXCERPT_SLUG} has no live shardfile in the catalogue`,
    )
  }
  const res = await get(`${api}/api/shardfiles/${hash}`)
  const packed = Buffer.from(await res.arrayBuffer())
  // The file is a brotli tar; storage that sends it with Content-Encoding: br has fetch unpack it already
  const tar =
    packed.toString('latin1', TAR_MAGIC_AT, TAR_MAGIC_AT + TAR_MAGIC.length) ===
    TAR_MAGIC
      ? packed
      : brotliDecompressSync(packed)
  const json = tarFile(tar, 'shard.json')
  if (json === undefined) {
    throw new Error(`site facts: ${EXCERPT_SLUG}'s shardfile has no shard.json`)
  }
  return shardfileExcerpt(JSON.parse(json.toString('utf8')) as ShardJson)
}

/** The live grid and the template's excerpt, from the API */
export async function readLive(
  api: string = API,
): Promise<{ grid: LiveGrid; shardfile: Record<string, unknown> }> {
  const shards = await readCatalogue(api)
  return {
    grid: gridFromCatalogue(shards),
    shardfile: await readExcerpt(shards, api),
  }
}

interface RawFacts {
  readonly grid: { readonly cells: readonly FactCell[] }
  readonly names?: Readonly<Record<string, string>>
  readonly shardfile?: Readonly<Record<string, unknown>>
}

export function readRaw(file: string): RawFacts {
  return JSON.parse(readFileSync(file, 'utf8')) as RawFacts
}

/** The facts file with the sources' numbers written in, keys in place; `live` absent keeps the committed grid */
export function refreshed(
  raw: RawFacts,
  format: FormatFacts,
  live?: { grid: LiveGrid; shardfile: Record<string, unknown> },
): RawFacts {
  const grid = live?.grid
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
    shardfile: live?.shardfile ?? raw.shardfile,
  } as RawFacts
}

export function factsText(raw: RawFacts): string {
  return `${JSON.stringify(raw, null, 2)}\n`
}

if (import.meta.main) {
  const offline = process.argv.includes('--offline')
  const live = offline ? undefined : await readLive()
  writeFileSync(
    FACTS_FILE,
    factsText(refreshed(readRaw(FACTS_FILE), await readFormat(), live)),
  )
  console.info(
    `site facts: wrote ${FACTS_FILE}${offline ? ' (offline: grid and excerpt kept)' : ` (${live?.grid.cells.length ?? 0} cells and ${EXCERPT_SLUG}'s shard.json from ${API})`}`,
  )
}
