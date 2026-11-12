#!/usr/bin/env bash
# PreToolUse(Bash) guard, for Claude Code and Codex alike: keep commits from sweeping in other agents'
# work. Several agents share this checkout and its ONE git index, so
# anything that snapshots the whole index (`git add -A/./-u`,
# `git commit -a`, a bare `git commit`) can carry a co-agent's staged
# files into your commit. The safe shape is a pathspec commit:
#
#     git add path/to/new-file              # new files only
#     git commit -m "..." -- path/a path/b  # commits exactly these
#
# Ported from kami-kakushi's guard-git-add-all.sh. Reads either tool's
# hook JSON on stdin through lib/payload.mjs; exits 2 (block, reason on
# stderr) or 0. Passes --amend, a merge commit that brings in only
# upstream changes (MERGE_HEAD set, nothing staged that upstream did not
# change), and anything with SKIP_SWEEPGUARD=1.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
input="$(cat)"
cmd="$(printf '%s' "$input" | node "$here/lib/payload.mjs" command 2>/dev/null)" || cmd=""
cwd=""
case "$cmd" in *commit*) cwd="$(printf '%s' "$input" | node "$here/lib/payload.mjs" cwd 2>/dev/null)" || cwd="" ;; esac
[ -n "$cmd" ] || exit 0

flat="$(printf '%s' "$cmd" | tr '\n' ' ')"
printf '%s' "$flat" | grep -q 'SKIP_SWEEPGUARD=1' && exit 0

deny() {
  cat >&2 <<EOF
BLOCKED by .agents/hooks/guard-git-add.sh: $1

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
  # A merge commit takes no pathspec. It passes when it brings in only
  # upstream's changes: MERGE_HEAD is set and every staged path is one
  # upstream changed (merge-base..MERGE_HEAD), conflict fixes included.
  # The repo is the one the commit runs in: the payload's cwd, then the
  # last `cd <dir>` before the commit, then the commit's `git -C <dir>`.
  at() { case "$2" in "~"*) printf '%s' "$HOME${2#\~}" ;; /*) printf '%s' "$2" ;; *) printf '%s' "$1/$2" ;; esac; }
  dir="${cwd:-$PWD}"
  before="${stripped%%"$segment"*}"
  to="$(printf '%s' "$before" | grep -oE '(^|[;&|(])[[:space:]]*cd[[:space:]]+[^[:space:];&|()]+' | tail -1 | sed -E 's/^.*cd[[:space:]]+//')"
  [ -z "$to" ] || dir="$(at "$dir" "$to")"
  to="$(printf '%s' "$segment" | grep -oE 'git[[:space:]]+-C[[:space:]]+[^[:space:]]+' | head -1 | sed -E 's/^git[[:space:]]+-C[[:space:]]+//')"
  [ -z "$to" ] || dir="$(at "$dir" "$to")"
  git_dir="$(git -C "$dir" rev-parse --absolute-git-dir 2>/dev/null)" || git_dir=""
  [ -n "$git_dir" ] && [ -e "$git_dir/MERGE_HEAD" ] || deny "bare git commit (no -- <pathspec>)"
  staged="$(git -C "$dir" diff --cached --name-only HEAD 2>/dev/null)" || deny "a merge commit whose staged paths could not be read"
  upstream="$(git -C "$dir" diff --name-only HEAD...MERGE_HEAD 2>/dev/null)" || deny "a merge commit whose upstream changes could not be read"
  extra="$(comm -23 <(printf '%s\n' "$staged" | sort -u) <(printf '%s\n' "$upstream" | sort -u) | grep -v '^$' | head -5 | tr '\n' ' ')"
  [ -z "$extra" ] || deny "a merge commit that also stages paths upstream did not change: ${extra% }"
fi
exit 0
