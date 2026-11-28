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
