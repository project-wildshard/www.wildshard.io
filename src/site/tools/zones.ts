// Each zone's short label on the site's grid pictures (a COPY.md entry): the claim grid, /build's grid, /mmo's map and
// home's sticky 5 × 5. Every zone on facts.json's grid needs one, and a label for a zone that left the grid is an
// error too (zones.test.ts), so the pictures never name a zone that isn't there. Open plots need none.
export const MAP_LABEL: Readonly<Record<string, string>> = {
  'brasscap-mesa': 'Map · Brasscap',
  'driftwood-isle': 'Map · Driftwood',
  'far-reach': 'Map · Sky Reach',
  glowfen: 'Map · Glowfen',
  'mirror-salt': 'Map · Mirror Salt',
  mossgate: 'Map · Mossgate',
  'nalati-grasslands': 'Map · Nalati',
  'nine-dragon-stack': 'Map · Nine Dragon',
  'pine-hollow': 'Map · Pine',
  'sunscar-dunes': 'Map · Dunes',
}
