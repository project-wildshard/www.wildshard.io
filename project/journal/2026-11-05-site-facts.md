# Site facts and the waitlist grid

- The form's grid and /build's picture were hand-written and wrong
  against facts.json: Driftwood on B2 (the facts say C3), Nine Dragon's
  D4 open, the open plots B2 and B4 shut. Both now come from
  `tools/claim-grid.ts`, so the pages hold a marker and no cells. The
  hard-coded "centre" went with them: facts.json puts Driftwood there,
  so `Map · centre` left COPY.md (an unused entry stops the build) and
  the /build description stopped counting a centre.
