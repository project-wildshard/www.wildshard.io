# Marketing site import

- Copied `site/` to `src/site/` and `site-deploy.yml` to
  `.github/workflows/` from Raynos/project-wildshard-singleplayer at
  3bd238492b, fresh history (J12). The root stays thin, so it lands
  under `src/`. The bytes are unchanged in this commit; lint and format
  skip `src/site/` until the next commits wire it in (D28).
- Wired it in: vite and `@vercel/blob` pinned at singleplayer's resolved
  versions at the root, `src/site/package.json` gone, `pnpm site:build`
  in CI. The site needs nothing from `@wildshard/format`, so no git dep
  and no org token in the deploy. A local build matched the live pages
  byte for byte (home, /mmo, /play, /map, /build, 404, css hash).
- Formatted the four tool files and took oxlint's fixes. 250 findings
  remain across 29 rules, mostly short names and magic numbers in the
  SVG maths: those stay on the shrink-only row in `src/.oxlintrc.json`
  (D28). Pages, css and data stay out of oxfmt: their bytes ship, and
  a tool writes `facts.json` and `media.json`. The build still matched
  the live pages afterwards.
