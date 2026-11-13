#!/usr/bin/env bash
# herdr-prompt.sh: a herdr write, sent only when its target is clear.
#
#   herdr-prompt.sh <agent> <message> [options]        herdr agent prompt
#   herdr-prompt.sh agent prompt|send-keys <target> ...
#   herdr-prompt.sh pane send-text|send-keys|run <pane> ...
#
# It asks herdr-question-open.sh (beside it) first and writes only on its
# "clear" answer. A blocked or unavailable target, an unresolved one, or
# a missing or non-executable helper refuses with exit 3, so the message
# never answers Jake's question. Codex lanes call this; Claude lanes get
# the same check from the PreToolUse guard guard-herdr-prompt.sh, which
# asks the same helper. Exit 2 is usage.
set -uo pipefail

usage() { echo "usage: herdr-prompt.sh <agent> <message> | agent prompt|send-keys <target> ... | pane send-text|send-keys|run <pane> ..." >&2; exit 2; }
case "${1:-} ${2:-}" in
  "agent prompt" | "agent send-keys" | "pane send-text" | "pane send-keys" | "pane run")
    group="$1" verb="$2"; shift 2 ;;
  *) group=agent verb=prompt ;;
esac
target="${1:-}"
[ -n "$target" ] && [ $# -ge 2 ] || usage
shift

check="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/herdr-question-open.sh"
refuse() { echo "herdr-prompt: not sent: $1. Put it in STATE.md or a commit message instead, or retry later." >&2; exit 3; }
[ -f "$check" ] && [ -x "$check" ] || refuse "$check is missing or not executable, so $target cannot be checked"
why="$("$check" "$target" 2>&1)" && rc=0 || rc=$?
case "$rc:$why" in
  1:clear*) ;;
  *) refuse "${why:-herdr-question-open.sh exited $rc}" ;;
esac
exec herdr "$group" "$verb" "$target" "$@"
