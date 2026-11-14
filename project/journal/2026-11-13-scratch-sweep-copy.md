# 2026-11-13: the kit's 3-day scratch sweep, copied in (DK8)

- `scripts/scratch-sweep.mjs` is repo-kit's DK6 janitor, byte for byte, beside `scratch-dir.mjs`; repo-kit's
  `cleanup-coverage` test checks the copy. It plans and logs the removal of `tmp/<task>/` folders untouched for 3
  days (`tmp/.sweep.log`) and removes nothing without `--live`, which waits on Jake's yes (meta REPO-DISK decision 1).
