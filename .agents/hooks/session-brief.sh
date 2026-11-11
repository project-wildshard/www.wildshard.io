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

echo "== $repo session brief (.agents/hooks/session-brief.sh) =="
if [ "$(git config core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  echo "!! git hooks are OFF in this clone. Run: git config core.hooksPath .githooks"
fi

echo
echo "-- other agents in this repo (herdr) --"
if [ "${HERDR_ENV:-}" != 1 ]; then
  echo "  (not running inside herdr)"
else
  peers="$(bash "$here/herdr-peers.sh" "$PWD" "$session")"
  if [ -n "$peers" ]; then
    printf '%s\n' "$peers" | while IFS="$(printf '\t')" read -r pane status goal where; do
      [ "$goal" = "-" ] && goal="(no goal set)"
      echo "  $pane  $status  $goal  [$where]"
    done
    echo "  They share this checkout and its index: commit only your own paths."
  else
    echo "  (none: you're the only agent here)"
  fi
fi

echo
echo "-- asks still open (docs/tasks/asks/: receipts; the queue is docs/plans/) --"
if [ -f src/scripts/asks.mjs ]; then
  node src/scripts/asks.mjs brief 2>/dev/null || echo "  (src/scripts/asks.mjs brief failed: read docs/tasks/asks/ directly)"
else
  echo "  (no ask tooling)"
fi

echo
echo "-- live plans (docs/plans/) --"
found=0
for plan in docs/plans/*.md; do
  [ -f "$plan" ] || continue
  [ "$(basename "$plan")" = README.md ] && continue
  found=1
  status="$(grep -m1 -E '^Status:' "$plan" | cut -c1-110)"
  echo "  $plan${status:+  ($status)}"
done
[ "$found" = 1 ] || echo "  (none)"

echo
echo "-- latest journal --"
# The journal file the newest commit touched (per-topic names don't sort
# by recency; 2026-11-04.md sorts after every 2026-11-04-<topic>.md).
latest="$(git log -1 --format= --name-only --diff-filter=AM -- 'project/journal/[0-9]*.md' 2>/dev/null | head -1)"
# Journal names are dated (YYYY-MM-DD[-topic].md): ls -t is safe here.
# shellcheck disable=SC2012
[ -n "$latest" ] && [ -f "$latest" ] || latest="$(ls -t project/journal/[0-9]*.md 2>/dev/null | head -1)"
if [ -n "$latest" ]; then
  echo "  $latest (last lines):"
  tail -6 "$latest" | sed 's/^/    /'
else
  echo "  (none)"
fi

echo
echo "-- main only: no branches, no worktrees (D27) --"
strays="$(
  git worktree list 2>/dev/null | tail -n +2 | sed 's/^/worktree /'
  git for-each-ref --format='branch %(refname:short)' refs/heads 2>/dev/null | grep -vx 'branch main'
  git for-each-ref --format='remote %(refname:short)' refs/remotes 2>/dev/null | grep -vxE 'remote [^/]+(/HEAD|/main)?'
)"
if [ -n "$strays" ]; then
  printf '%s\n' "$strays" | sed 's/^/  !! /'
  echo "  !! Not main-only. Land any work on main (git cherry main <branch>),"
  echo "  !! remove the worktree, and ask Jake to delete the branch."
else
  echo "  (clean: main only)"
fi

echo
echo "-- uncommitted in this checkout (may be another agent's: don't sweep it) --"
dirty="$(git status --short 2>/dev/null | head -12)"
if [ -n "$dirty" ]; then printf '%s\n' "$dirty" | sed 's/^/  /'; else echo "  (clean)"; fi

echo
echo "-- recent commits --"
git log --oneline -8 2>/dev/null | sed 's/^/  /'

echo
echo "Commit by pathspec (git commit -m ... -- paths) with a journal entry;"
echo "hooks enforce the rest. Rules: docs/dev.md."
exit 0
