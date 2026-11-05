#!/usr/bin/env bash
# List the OTHER agents herdr sees working in this repo (the main
# checkout or any worktree under it), one per line:
#   <pane>\t<status>\t<goal>\t<where>
# goal is the agent's status-line title (set by ~/.claude/set-label.sh),
# else its herdr `goal` token, else "-" (bash `read` collapses empty
# tab fields). where is "main" or the worktree path.
#
# Prints nothing and exits 0 outside herdr (HERDR_ENV != 1) or without
# herdr / jq, so callers treat no output as "solo". Ported from
# kami-kakushi's herdr-peers.sh, simplified for herdr 0.9: one
# `herdr agent list` carries status, cwd, tokens and title.
#
# Self is excluded by Claude session id ($CLAUDE_CODE_SESSION_ID or
# arg 2), falling back to $HERDR_PANE_ID. Arg 1: repo root (default:
# the git toplevel).
set -uo pipefail

[ "${HERDR_ENV:-}" = 1 ] || exit 0
command -v herdr >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

root="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
session="${2:-${CLAUDE_CODE_SESSION_ID:-}}"

herdr agent list 2>/dev/null | jq -r \
  --arg root "$root" --arg session "$session" --arg pane "${HERDR_PANE_ID:-}" '
  .result.agents[]?
  | (.cwd // .foreground_cwd // "") as $cwd
  | select($cwd == $root or ($cwd | startswith($root + "/")))
  | select(($session != "" and (.agent_session.value // "") == $session) | not)
  | select(($session == "" and $pane != "" and .pane_id == $pane) | not)
  | [ .pane_id,
      (.agent_status // "?"),
      ((.terminal_title_stripped // "") | sub("^[^A-Za-z0-9] "; "") | if . == "" then null else . end)
        // ((.tokens.goal // "") | if . == "" then "-" else . end),
      (if ($cwd | startswith($root + "/.claude/worktrees/"))
        then ($cwd | ltrimstr($root + "/") | split("/")[0:3] | join("/"))
        else "main" end)
    ]
  | @tsv' 2>/dev/null || true
