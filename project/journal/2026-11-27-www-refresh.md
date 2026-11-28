# The wildshard.io refresh (meta WWW-REFRESH)

Jake, 11-27: bring the site current: copy, facts, timeline, vision.
One plan, in meta `docs/plans/2026-11-27-opus-www-refresh-PLAN.md`;
his four calls are J535 (two doors, zone, ship alpha 2, the cleanroom
saga in place of Coming worlds).

- WW1, the facts file. `pnpm site:facts` now reads the live grid from
  api.wildshard.io's catalogue (with the agent marker) instead of a
  hand-kept list: ten zones and fifteen open plots, Mirror Salt alone
  on B1. The format pin jumped 0.4.5 to 0.82.8; the path counter
  learned five validation actions the schema grew (non_empty,
  readonly, some_item, gt_value). The format's memory gates (1.2 and
  1.8 GB) are stale, so the memory lines are hand-kept from engine
  `budgets/caps.json` (J410 1.5 GB loading, J445 1 GB playing target);
  the download lines come from the format's tiers (J338). Map labels
  moved to `tools/zones.ts`, with a test that the labels and the
  grid's zones are the same set.

- WW2, the words. A glossary comment tops COPY.md (zone, shardfile,
  the grid, open plot, Enter the MMO, Zone Select, cleanroom), and
  tools/words.ts lists the retired words. Its test counts what is left
  (179 under 137 headings at the start) and enforces once WW15 makes
  SITE_WORDS=enforce the default. The bare word shard is retired for a
  place (J535); shardfile, shard.json and the shard-* repos stay.

- WW3, the hero. J535 picked prototype C: two doors under the line,
  Play (the Driftwood capture, Play now full width, Explore and Staging
  under it) and Build (the typed prompt pane, Become a creator). It is
  the old hero's pieces laid out again under .hero.hero2, so the typing
  script and the world's frame still work. Preview left the doors for
  Explore until the fix-preview plan settles. (WW1's note says five
  validation actions; it was four.)
