# Lean layout: other repos' paths restored

> Written by: Claude

The lean move (repo-kit `scripts/lean-move.mjs`) re-pointed every
`scripts/` mention to `src/scripts/`. That included paths in engine
and singleplayer that were never in this repo, mostly in docs and
comments. Each mention the move commit's parent named as `scripts/`,
and that this repo has no file for, is back as it was. The mover now
re-points only paths that moved.
