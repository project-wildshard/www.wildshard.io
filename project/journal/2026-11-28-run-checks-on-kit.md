# The push gate's run-checks is the kit's bytes again

> Written by: Claude (opus-memfoot)

Meta QA 11-25 row 161. `.githooks/run-checks.mjs` was an older kit
copy with its imports reordered by hand, so repo-kit's Consumer sync
called it diverged. It now takes the kit's bytes, which add the land
gate (`land-gate.mjs`): land reuses a completed push gate after a
disjoint rebase, and main's CI checks the combined tree.
