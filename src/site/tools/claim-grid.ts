// The 5 × 5 claim maps (MS16): home's waitlist form and /build's picture, both drawn from facts.json's grid so a page
// never has its own idea of who sits where. api-server refuses the same cells: src/server/routes/waitlist-grid.json
// there is a copy of `cells`, and CI compares the two (docs/dev.md, "Refreshing the site's facts").
//   cellName(c)                  'C3' from (0, 0): columns A–E run west to east, rows 1–5 north to south
//   takenCells(cells)            the names no one can claim, in reading order
//   claimGridHtml(cells, label)  the form's radios, <!--gen:claimgrid-->
//   buildGridHtml(cells, label)  /build's picture, <!--gen:buildgrid-->
import type { FactCell } from './facts.ts'

const COLUMNS = 'ABCDE'
const MID = (COLUMNS.length - 1) / 2
/** The open plot /build points at as "yours?" */
const YOURS = 'E3'
const WISH = '{{Map · your wish}}'
const YOURS_LABEL = '{{Build · grid yours}}'

type Place = Pick<FactCell, 'x' | 'z'>
/** The COPY.md slot that names a cell's shard */
export type CellLabel = (cell: FactCell) => string

const column = (c: Place): number => c.x + MID
const row = (c: Place): number => MID - c.z

export function cellName(c: Place): string {
  const letter = COLUMNS[column(c)]
  if (letter === undefined || row(c) < 0 || row(c) >= COLUMNS.length) {
    throw new Error(`site: grid cell (${c.x}, ${c.z}) is off the 5 × 5`)
  }
  return `${letter}${row(c) + 1}`
}

function readingOrder(cells: readonly FactCell[]): readonly FactCell[] {
  return cells.toSorted((a, b) => row(a) - row(b) || column(a) - column(b))
}

export function takenCells(cells: readonly FactCell[]): readonly string[] {
  return readingOrder(cells)
    .filter(c => !c.plot)
    .map(c => cellName(c))
}

export function claimGridHtml(
  cells: readonly FactCell[],
  label: CellLabel,
): string {
  return readingOrder(cells)
    .map(c => {
      const name = cellName(c)
      return c.plot
        ? `<label class="cell"><input type="radio" name="cell" value="${name}"><i>${name}</i><b>${WISH}</b></label>`
        : `<span class="cell taken"><i>${name}</i><b>${label(c)}</b></span>`
    })
    .join('\n')
}

export function buildGridHtml(
  cells: readonly FactCell[],
  label: CellLabel,
): string {
  if (takenCells(cells).includes(YOURS)) {
    throw new Error(`site: /build offers ${YOURS}, but a shard sits there`)
  }
  return readingOrder(cells)
    .map(c => {
      const name = cellName(c)
      if (name === YOURS) {
        return `<span class="cell b-yours"><i>${name}</i><b>${YOURS_LABEL}</b></span>`
      }
      return c.plot
        ? `<span class="cell"><i>${name}</i></span>`
        : `<span class="cell taken"><i>${name}</i><b>${label(c)}</b></span>`
    })
    .join('')
}
