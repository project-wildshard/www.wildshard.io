#!/usr/bin/env bash
# REPO-DISK DK7: measure ./tmp for the session brief, off its hot path.
# `du` over a big ./tmp takes seconds (engine's 122 GiB: 12 s), so the
# brief reads the last result from tmp/.disk-line and starts this in the
# background when that is missing or an hour old. It writes one line,
# "<KiB> <folders over 3 days> <epoch seconds>", and exits; nothing
# lingers. A folder is over 3 days when nothing in it was written for
# 3 days and it has no .keep (repo-kit disk's stale rule, DK1).
#   bash .agents/hooks/lib/tmp-measure.sh <repo root> [locked]
# "locked": the brief took tmp/.disk-line.lock for this run; free it at
# the end. WS_TMP_FAKE_KIB stands in for du's total (tests).
set -uo pipefail
root="${1:?usage: tmp-measure.sh <repo root> [locked]}"
[ "${2:-}" = locked ] && trap 'rmdir "$root/tmp/.disk-line.lock" 2>/dev/null' EXIT
cd "$root/tmp" 2>/dev/null || exit 0
kib="${WS_TMP_FAKE_KIB:-$(du -sk . 2>/dev/null | cut -f1)}"
# No total, no line: the next session tries again rather than show 0 GiB.
[[ "$kib" =~ ^(0|[1-9][0-9]*)$ ]] || exit 0
stale=0
for dir in *; do
  # Symlinked folders are skipped, as du skips them: find would follow.
  [ -d "$dir" ] && [ ! -L "$dir" ] || continue
  [ -e "$dir/.keep" ] && continue
  [ -n "$(find "./$dir" -mmin -4320 -print -quit 2>/dev/null)" ] || stale=$((stale + 1))
done
printf '%s %s %s\n' "$kib" "$stale" "$(date +%s)" > ".disk-line.$$" && mv ".disk-line.$$" .disk-line
