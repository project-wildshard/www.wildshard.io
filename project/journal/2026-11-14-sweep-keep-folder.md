# 2026-11-14: the scratch sweep keeps a tmp/keep folder (REPO-DISK DK6)

- repo-kit's `scripts/scratch-sweep.mjs`, byte for byte: a folder named `tmp/keep` is kept (singleplayer keeps
  hand-kept work there); the sweep only read `tmp/keep` as a list file before. Still a dry run unless `--live`.
