#!/usr/bin/env bash
# PreToolUse(Bash) guard: keep commits from sweeping in other agents'
# work. Several agents share this checkout and its ONE git index, so
# anything that snapshots the whole index (`git add -A/./-u`,
# `git commit -a`, a bare `git commit`) can carry a co-agent's staged
# files into your commit. The safe shape is a pathspec commit:
#
#     git add path/to/new-file              # new files only
#     git commit -m "..." -- path/a path/b  # commits exactly these
#
# Ported from kami-kakushi's guard-git-add-all.sh. Reads the hook JSON
# on stdin; exits 2 (block, reason on stderr) or 0. Passes --amend, a
# merge in progress, and anything with SKIP_SWEEPGUARD=1.
set -uo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || cmd=""
[ -n "$cmd" ] || exit 0

flat="$(printf '%s' "$cmd" | tr '\n' ' ')"
printf '%s' "$flat" | grep -q 'SKIP_SWEEPGUARD=1' && exit 0

deny() {
  cat >&2 <<EOF
BLOCKED by .claude/hooks/guard-git-add.sh: $1

This checkout's git index is shared with other agents. Commit by
pathspec so only your paths go in:

    git add path/to/new-file              # new files only
    git commit -m "..." -- path/a path/b

Never git add -A / . / -u, git commit -a, or a bare git commit.
Deliberate whole-index commit: SKIP_SWEEPGUARD=1.
EOF
  exit 2
}

# Strip quoted strings (commit messages may contain ; & | or --),
# then look at each command segment between ; & | boundaries.
stripped="$(printf '%s' "$flat" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")"
B='(^|[;&|(])[[:space:]]*'
ADD="${B}git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+add([[:space:]]+[^;&|]*)?"
COMMIT="${B}git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit"

if printf '%s' "$stripped" | grep -qE "${ADD}[[:space:]](-A|--all|-[A-Za-z]*A[A-Za-z]*)([[:space:]]|$)"; then
  deny "git add -A / --all"
fi
if printf '%s' "$stripped" | grep -qE "${ADD}[[:space:]](\.|:/|\*)([[:space:]]|$)"; then
  deny "git add . (stages the whole tree)"
fi
if printf '%s' "$stripped" | grep -qE "${ADD}[[:space:]](-u|--update|-[A-Za-z]*u[A-Za-z]*)([[:space:]]|$)"; then
  deny "git add -u (stages every tracked edit)"
fi
if printf '%s' "$stripped" | grep -qE "${COMMIT}([[:space:]]+[^;&|]*)?[[:space:]](--all|-[A-Za-z]*a[A-Za-z]*)([[:space:]]|$)"; then
  deny "git commit -a (stages every tracked edit)"
fi

segment="$(printf '%s' "$stripped" | grep -oE "${COMMIT}([[:space:]][^;&|]*)?" | head -1)"
if [ -n "$segment" ] \
  && ! printf '%s' "$segment" | grep -qE '[[:space:]]--amend([[:space:]]|$)' \
  && ! printf '%s' "$segment" | grep -qE '[[:space:]]--([[:space:]]|$)'; then
  git_dir="$(git rev-parse --git-dir 2>/dev/null || echo .git)"
  [ -e "$git_dir/MERGE_HEAD" ] || deny "bare git commit (no -- <pathspec>)"
fi
exit 0
