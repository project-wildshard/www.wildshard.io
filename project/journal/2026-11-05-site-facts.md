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
