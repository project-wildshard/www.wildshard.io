// `pnpm site:api-grid <waitlist-grid.json>`: fails when api-server's copy of the grid isn't facts.json's, so the form
// and the endpoint behind it can't drift. CI hands it api-server's file; on a machine with both repos, point it at
// ../api-server/src/server/routes/waitlist-grid.json. `pnpm site:grid` in api-server fixes the copy.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { readFacts } from './facts.ts'

import type { FactCell } from './facts.ts'

const FACTS_FILE = fileURLToPath(new URL('../facts.json', import.meta.url))

function row(c: FactCell): string {
  return JSON.stringify({ x: c.x, z: c.z, slug: c.slug, plot: c.plot })
}

/** What disagrees between the two grids; empty when they match */
export function disagreement(
  site: readonly FactCell[],
  api: readonly FactCell[],
): readonly string[] {
  const left = new Set(site.map(c => row(c)))
  const right = new Set(api.map(c => row(c)))
  return [
    ...[...left].filter(r => !right.has(r)).map(r => `site only: ${r}`),
    ...[...right].filter(r => !left.has(r)).map(r => `api-server only: ${r}`),
  ]
}

export function apiCells(file: string): readonly FactCell[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { cells: FactCell[] }).cells
}

if (import.meta.main) {
  const [file] = process.argv.slice(2)
  if (file === undefined) {
    throw new Error('usage: api-grid.ts <waitlist-grid.json>')
  }
  const differences = disagreement(readFacts(FACTS_FILE).cells, apiCells(file))
  if (differences.length > 0) {
    throw new Error(
      `api-server's grid disagrees with facts.json; run \`pnpm site:grid\` there:\n${differences.join('\n')}`,
    )
  }
  console.info('site: api-server has the same grid')
}
