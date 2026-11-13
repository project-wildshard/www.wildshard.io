#!/usr/bin/env bash
# ask-new.sh — claim the next ask id and create docs/tasks/asks/<ID>.md
# (one file per request for work from Jake; rules in
# docs/tasks/asks/README.md). Ported from project-wildshard-singleplayer.
#
#   kit/scripts/ask-new.sh "<Jake's words>" [series letter, default A]
#
# The file IS the claim: it is created with noclobber (O_EXCL), so two
# agents asking at the same moment get two different ids. Prints the new
# file's path. Fill in the rest with Edit, then commit it by pathspec.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
ask="${1:?usage: kit/scripts/ask-new.sh \"<the request, in Jake words>\" [series letter]}"
series="${2:-A}"
dir=docs/tasks/asks
mkdir -p "$dir"
max="$(ls "$dir" 2>/dev/null | grep -oE "^${series}[0-9]+\.md$" | grep -oE '[0-9]+' | sort -n | tail -1)"
n=$(( ${max:-0} + 1 ))
set -o noclobber
for _ in $(seq 1 50); do
  f="$dir/${series}${n}.md"
  if { printf '# %s%s\n\n**Status:** open (%s)\n**Ask:** %s\n' "$series" "$n" "$(date +%F)" "$ask" > "$f"; } 2>/dev/null; then
    echo "$f"
    exit 0
  fi
  n=$(( n + 1 ))
done
echo "ask-new: could not claim an id in series $series" >&2
exit 1
