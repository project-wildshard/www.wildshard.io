# Site facts and the waitlist grid

- The form's grid and /build's picture were hand-written and wrong
  against facts.json: Driftwood on B2 (the facts say C3), Nine Dragon's
  D4 open, the open plots B2 and B4 shut. Both now come from
  `tools/claim-grid.ts`, so the pages hold a marker and no cells. The
  hard-coded "centre" went with them: facts.json puts Driftwood there,
  so `Map · centre` left COPY.md (an unused entry stops the build) and
  the /build description stopped counting a centre.
- `@wildshard/format` v0.3.1 is a dev dependency, for the facts refresh
  only. The build still reads nothing of it, but `site-deploy` has to
  install it, so that job now mints the org app token too. The journal
  line in the import entry about no org token in the deploy is history.
- The refresh no longer needs a game checkout: `pnpm site:facts` writes
  the cell size, pitch, memory caps and schema path count from the
  format. `schemaInventory` isn't exported, so `tools/schema-paths.ts`
  ports the walk; singleplayer's own (1e55422db9) and the port both say
  8604 on format v0.2.0 and v0.3.1.
- Honest result: no number moved. The v0.3.x diff is net input and a
  boss arena row, so 8604, 1200 / 1800, 500 and 562.5 all still hold.
  The only false thing in the file was its `$doc`, which said a
  singleplayer script writes it. The grid, road (15) and template
  excerpt also match singleplayer at 1e55422db9, read from source; the
  excerpt was not rebuilt from `out/_template/shard.json`.
- `ENTRY_ASPHALT` is 15 too, but it is how deep the asphalt runs into a
  cell, not the road's width, so `road` stays by hand until the engine
  has a tag.
- The form and api-server's `TAKEN` can't share one file across repos,
  so api-server keeps a copy of `grid.cells` and each repo's CI compares
  with the other's `main`. Tests may not touch the network, so `pnpm
  check` proves the comparison on real files and CI runs it for real.
