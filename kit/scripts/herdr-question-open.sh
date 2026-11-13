#!/usr/bin/env bash
# herdr-question-open.sh <agent|pane>: may a herdr write go to that target now?
#
# A herdr paste into a pane that has a question open (Claude's
# AskUserQuestion, a Codex question, an approval prompt) lands in the
# answer field and picks for Jake (Jake, 2026-10-12, G232/G233). Read
# before write: the PreToolUse guard (guard-herdr-prompt.sh) and the
# wrapper (herdr-prompt.sh) both ask this script before any herdr
# write, so both refuse the same targets.
#
# It prints one line and exits:
#   1  "clear: ..."        the target resolves, its status and screen
#                          were read, and no question is open. Exit 1
#                          with "clear" is the only answer that permits
#                          a write.
#   0  "blocked: ..."      a question or approval prompt is open.
#   3  "unavailable: ..."  the target does not resolve to an agent or
#                          pane, or herdr, jq, its status or its screen
#                          could not be read. Not knowing is not clear.
#   2                      usage.
# Exit 0 keeps the old "a question is open" meaning for `if` callers.
set -uo pipefail

target="${1:-}"
[ -n "$target" ] && [ $# -eq 1 ] || { echo "usage: herdr-question-open.sh <agent|pane>" >&2; exit 2; }

say() { printf '%s\n' "$2"; exit "$1"; }
unavailable() { say 3 "unavailable: $target $1"; }

command -v herdr >/dev/null 2>&1 || unavailable "cannot be inspected: herdr is not on PATH"
command -v jq >/dev/null 2>&1 || unavailable "cannot be inspected: jq is not on PATH"

# Resolve: an agent name or pane id through `agent get`, then a plain
# pane through `pane get`. Only *_not_found from both means unresolved.
info="" codes=""
for kind in agent pane; do
  out="$(herdr "$kind" get "$target" 2>/dev/null)" && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    info="$(printf '%s' "$out" | jq -ce ".result.$kind | objects" 2>/dev/null)" || info=""
    [ -n "$info" ] && break
    unavailable "could not be read: herdr $kind get gave no $kind status"
  else
    # herdr prints its error JSON on stderr; read it again with both streams.
    code="$(herdr "$kind" get "$target" 2>&1 | jq -r '.error.code // empty' 2>/dev/null | head -n 1)"
    codes="$codes $kind:${code:-exit-$rc}"
  fi
done
if [ -z "$info" ]; then
  case "$codes" in
    " agent:agent_not_found pane:pane_not_found") unavailable "does not resolve to a herdr agent or pane" ;;
    *) unavailable "could not be read (herdr:$codes)" ;;
  esac
fi

pane="$(printf '%s' "$info" | jq -r '.pane_id // empty')"
[ -n "$pane" ] || unavailable "resolved without a pane id"
# A pane running an agent must report its status; a plain shell pane has none.
has_agent="$(printf '%s' "$info" | jq -r 'if (.agent // null) == null then "no" else "yes" end')"
status="$(printf '%s' "$info" | jq -r '.agent_status // empty')"
[ "$has_agent" = no ] || [ -n "$status" ] || unavailable "($pane) has an agent but no readable status"
[ "$status" = blocked ] && say 0 "blocked: $target ($pane) is blocked (herdr sees a question or approval prompt open)"

screen="$(herdr pane read "$pane" --source visible 2>/dev/null)" || unavailable "($pane): its screen could not be read"
if printf '%s' "$screen" | grep -qE 'Enter to select|to navigate|Skip for now|Type something\.|\? [0-9]+ questions?|Do you want to proceed\?'; then
  say 0 "blocked: $target ($pane) is showing a question on screen"
fi
say 1 "clear: $target ($pane) is ${status:-a plain pane} with no question on screen"
