# Kit re-stamp after the lean move

> Written by: Claude

repo-kit's lean-layout R1 is closing out. Every lean repo takes the
kit files that changed after its own move, among them `bin-pins.mjs`,
which now refuses a stale bin runner first (meta QA row 56). This
keeps the kit plan `same` everywhere.
