#!/usr/bin/env bash
# SessionStart brief, for Claude Code and Codex alike: a fast, read-only
# orientation printed into the session's context (wired from
# .agents/hooks.json; ported from rockhop). Never fails the session.
# Every repo carries the same bytes: the repo name is read at run time.
# Run by hand any time:
#   bash .agents/hooks/session-brief.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0
# The clone's folder name, as the kit names repos; a plan worktree
# (.worktrees/<plan>) reports its canonical checkout's name.
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
repo="$(basename "$(dirname "${common:-$root/.git}")")"

# SessionStart passes its JSON on stdin; its session_id lets the herdr
# section leave this session out. Run by hand, stdin is a terminal.
session="${CLAUDE_CODE_SESSION_ID:-}"
if [ -z "$session" ] && [ ! -t 0 ]; then
  session="$(node "$here/lib/payload.mjs" session 2>/dev/null)"
fi

# The brief lands in every session's context, so it stays within 40
# lines (REPO-KIT K4, J273): 5 asks, 5 plans, 4 journal lines, 3 of
# the rest. A cut section says "first N of M" in its header.
# show TITLE MAX EMPTY BODY: a section header, then at most MAX lines of
# BODY, or EMPTY when BODY is empty.
show() {
  local n
  if [ -z "$4" ]; then printf -- '-- %s --\n  %s\n' "$1" "$3"; return; fi
  n="$(printf '%s\n' "$4" | wc -l | tr -d ' ')"
  if [ "$n" -gt "$2" ]; then printf -- '-- %s, first %s of %s --\n' "$1" "$2" "$n"; else printf -- '-- %s --\n' "$1"; fi
  printf '%s\n' "$4" | head -n "$2"
}

echo "== $repo session brief (.agents/hooks/session-brief.sh) =="
if [ "$(git config core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  echo "!! git hooks are OFF in this clone. Run: git config core.hooksPath .githooks"
fi

if [ "${HERDR_ENV:-}" != 1 ]; then
  show "other agents in this repo (herdr)" 3 "(not running inside herdr)" ""
else
  peers="$(bash "$here/herdr-peers.sh" "" "$session" | while IFS="$(printf '\t')" read -r pane status goal where; do
    [ "$goal" = "-" ] && goal="(no goal set)"
    echo "  $pane  $status  $goal  [$where]"
  done)"  # "": the canonical checkout
  show "other agents in this repo (herdr)" 3 "(none: you're the only agent here)" "$peers"
  [ -n "$peers" ] && echo "  They share this checkout and its index: commit only your own paths."
fi

if [ -f kit/scripts/asks.mjs ]; then
  asks="$(node kit/scripts/asks.mjs brief 2>/dev/null || echo "  (kit/scripts/asks.mjs brief failed: read docs/tasks/asks/ directly)")"
else
  asks="  (no ask tooling)"
fi
show "asks still open (docs/tasks/asks/: receipts; the queue is docs/plans/)" 5 "(none)" "$asks"

# -- live plans --
plans=""
for plan in docs/plans/*.md; do
  [ -f "$plan" ] || continue
  [ "$(basename "$plan")" = README.md ] && continue
  # The plan's State line (K2: draft, ready for review, draft parked,
  # in progress, held, done), plain, bold or quoted; a plan from before
  # K2 shows its old Status line instead.
  state="$(grep -m1 -E '^(> *)?(\*\*)?State:' "$plan" || grep -m1 -E '^(> *)?(\*\*)?Status:' "$plan")"
  state="$(printf '%s' "$state" | sed -E 's/^> *//; s/\*\*//g' | cut -c1-110)"
  plans+="  $plan${state:+  ($state)}"$'\n'
done
show "live plans (docs/plans/)" 5 "(none)" "${plans%$'\n'}"

# -- latest journal --
# The journal file the newest commit touched (per-topic names don't sort
# by recency; 2026-11-04.md sorts after every 2026-11-04-<topic>.md).
latest="$(git log -1 --format= --name-only --diff-filter=AM -- 'project/journal/[0-9]*.md' 2>/dev/null | head -1)"
# Journal names are dated (YYYY-MM-DD[-topic].md): ls -t is safe here.
# shellcheck disable=SC2012
[ -n "$latest" ] && [ -f "$latest" ] || latest="$(ls -t project/journal/[0-9]*.md 2>/dev/null | head -1)"
if [ -n "$latest" ]; then
  echo "-- latest journal: $latest (last lines) --"
  tail -4 "$latest" | sed 's/^/    /'
else
  show "latest journal" 4 "(none)" ""
fi

# A repo with the plan-worktree tool (scripts/worktree.mjs; engine since
# J240, the rest at WORKTREE-LAND-STANDARD WL4) also allows
# .worktrees/<slug> on plan/<slug>; any other repo stays main only.
plan_wt='/\.worktrees/[a-z0-9][a-z0-9._-]* +[0-9a-f]+ \[plan/'
plan_branch='^branch plan/[a-z0-9][a-z0-9._-]*$'
plan_remote='^remote [^/]+/plan/[a-z0-9][a-z0-9._-]*$'
if [ -f scripts/worktree.mjs ]; then
  echo "-- main only, plus plan worktrees: .worktrees/<slug> on plan/<slug> (D27, J221, J240) --"
  wts="$(git worktree list 2>/dev/null | tail -n +2 | grep -E "$plan_wt" | sed -E 's#^.*/(\.worktrees/[^ ]+) .*#\1#' || true)"
  if [ -n "$wts" ]; then
    echo "  plan worktrees ($(printf '%s\n' "$wts" | wc -l | tr -d ' ')): $(printf '%s\n' "$wts" | tr '\n' ' ')" | cut -c1-150
  fi
else
  echo "-- main only: no branches, no worktrees (D27) --"
  plan_wt='^$'; plan_branch='^$'; plan_remote='^$'
fi
strays="$(
  git worktree list 2>/dev/null | tail -n +2 | grep -vE "$plan_wt" | sed 's/^/worktree /'
  git for-each-ref --format='branch %(refname:short)' refs/heads 2>/dev/null | grep -vx 'branch main' | grep -vE "$plan_branch"
  git for-each-ref --format='remote %(refname:short)' refs/remotes 2>/dev/null | grep -vxE 'remote [^/]+(/HEAD|/main)?' | grep -vE "$plan_remote"
)"
if [ -n "$strays" ]; then
  printf '%s\n' "$strays" | head -3 | sed 's/^/  !! /'
  echo "  !! Not main-only ($(printf '%s\n' "$strays" | wc -l | tr -d ' ') in all): land work on main (git cherry main <branch>), remove the worktree, ask Jake to delete the branch."
else
  echo "  (clean: main only)"
fi

# -- ./tmp (REPO-DISK DK7) --
# One line: size, folders, folders over 3 days, folders without an
# .owner (scratch-dir.mjs writes it, DK3); a warning over 30 GiB. The
# size comes from tmp/.disk-line, which lib/tmp-measure.sh refreshes in
# the background once it is an hour old (du takes seconds on a big
# ./tmp; the brief must not). WS_TMP_MEASURE=sync measures inline.
folders=0; unowned=0; entries=0
for entry in tmp/*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  entries=$((entries + 1))
  [ -d "$entry" ] && [ ! -L "$entry" ] || continue
  folders=$((folders + 1))
  [ -e "$entry/.owner" ] || unowned=$((unowned + 1))
done
if [ "$entries" = 0 ]; then
  echo "-- ./tmp is empty --"
else
  # tmp/.disk-line: "<KiB> <folders over 3 days> <epoch seconds>". No
  # leading zeros, so bash never reads a field as octal.
  measured() {
    local n='^(0|[1-9][0-9]*)$'
    kib=""; stale=""; at=""
    read -r kib stale at 2>/dev/null < tmp/.disk-line
    [[ "$kib" =~ $n && "$stale" =~ $n && "$at" =~ $n ]]
  }
  if [ "${WS_TMP_MEASURE:-}" = sync ]; then
    bash "$here/lib/tmp-measure.sh" "$root"
  elif ! measured || [ -z "$(find tmp/.disk-line -mmin -60 2>/dev/null)" ]; then
    # A lock left by a killed walk frees itself after 30 minutes.
    find tmp/.disk-line.lock -maxdepth 0 -mmin +30 -exec rmdir {} \; 2>/dev/null
    if mkdir tmp/.disk-line.lock 2>/dev/null; then
      nohup nice bash "$here/lib/tmp-measure.sh" "$root" locked </dev/null >/dev/null 2>&1 &
    fi
  fi
  if measured; then
    # The folder counts are live; the size and the age count are from the
    # measurement, so an age count over today's folders is capped.
    [ "$stale" -gt "$folders" ] && stale="$folders"
    gib="$(awk -v k="$kib" 'BEGIN { printf "%.1f", k / 1048576 }')"
    warn=""
    [ "$kib" -gt 31457280 ] && warn=" !! over 30 GiB: delete your finished folders, keep only logs and JSON (REPO-DISK DK5)"
    echo "-- ./tmp is $gib GiB in $folders folders; $stale over 3 days; $unowned without an owner (size and age measured $(( ($(date +%s) - at) / 60 )) min ago) --$warn"
  else
    echo "-- ./tmp has $folders folders; $unowned without an owner; size measuring now, the next session shows it --"
  fi
fi

show "uncommitted in this checkout (may be another agent's: don't sweep it)" 3 "(clean)" "$(git status --short 2>/dev/null | sed 's/^/  /')"
show "recent commits" 3 "(none)" "$(git log --oneline -3 2>/dev/null | sed 's/^/  /')"
echo "Commit by pathspec (git commit -m ... -- paths) with a journal entry; hooks enforce the rest. Rules: docs/dev.md."
exit 0
