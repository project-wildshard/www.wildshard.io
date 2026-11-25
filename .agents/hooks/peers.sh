#!/usr/bin/env bash
# List the OTHER agents herdr-core (`hc`) runs in this repo (the main
# checkout or any worktree under it), one per line:
#   <terminal>\t<status>\t<goal>\t<where>
# terminal is its hc address (t1f). status is its reported state
# (idle, working, done, blocked, error), else "?". goal is its `goal` hc
# label, else the status message the agent reports, else "-" (bash
# `read` collapses empty tab fields). where is "main" or the worktree
# path (.worktrees/<slug>).
#
# Prints nothing and exits 0 outside hc (no $HC_TERMINAL_ID) or without
# hc / jq, so callers treat no output as "solo". `hc ls` gives each
# terminal's launch folder; the folder its agent works in now is
# `foreground.cwd` in `hc get`, so each agent is read once.
#
# Self is excluded by address: arg 2, else $HC_TERMINAL_ID. Arg 1: repo
# root (default: the canonical checkout, from any of its worktrees).
set -uo pipefail

[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
command -v hc >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# The canonical checkout, even from a linked plan worktree (.worktrees/<slug>,
# DEV-SPEED DS6), so every agent in the repo is listed with where it works.
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
canonical="${common%/.git}"
[ "$canonical" != "$common" ] || canonical="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
root="${1:-$canonical}"  # an empty arg 1 also means the canonical checkout
self="${2:-$HC_TERMINAL_ID}"

# Live terminals running something other than a plain shell: the agents.
agents="$(hc ls 2>/dev/null | jq -r '
  .terminals[]?
  | select(.state == "live")
  | select((.agent // "") as $a | ["", "bash", "zsh", "sh", "dash", "ksh", "fish", "nu"] | index($a) | not)
  | .address' 2>/dev/null)" || exit 0

for terminal in $agents; do
  [ "$terminal" = "$self" ] && continue
  hc get "$terminal" 2>/dev/null | jq -r --arg root "$root" '
    (.foreground.cwd // .cwd // "") as $cwd
    | select($cwd == $root or ($cwd | startswith($root + "/")))
    | [ .address,
        ((.status | if type == "object" then .state else . end) // "?"),
        ((.labels.goal // (.status | if type == "object" then .msg else null end) // "")
          | gsub("[\t\n]"; " ") | if . == "" then "-" else . end),
        (if ($cwd | startswith($root + "/.worktrees/"))
          then ($cwd | ltrimstr($root + "/") | split("/")[0:2] | join("/"))
          elif ($cwd | startswith($root + "/.claude/worktrees/"))
          then ($cwd | ltrimstr($root + "/") | split("/")[0:3] | join("/"))
          else "main" end)
      ]
    | @tsv' 2>/dev/null || true
done
