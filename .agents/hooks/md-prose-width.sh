#!/usr/bin/env bash
# PostToolUse advisory after an edit (Claude Edit|Write, Codex
# apply_patch): markdown prose wraps at ~72 chars (Jake's norm). Ported
# from kami-kakushi's md-prose-width.sh.
#
# A hook, not a gate: tables, long URLs and code spans legitimately run
# long, and a red commit over a soft norm trains everyone to bypass it.
# The long lines are born in agent edits, so that is where to say so.
# It reports and never rewrites (a rewrite would break the agent's next
# Edit, whose old_string must match), and only lines added vs HEAD.
#
# Reads either tool's PostToolUse JSON on stdin through lib/payload.mjs
# (one patch can touch several files). Exit 2 + stderr = advice shown to
# the agent (the write already happened). Exit 0 = clean or not
# applicable. Escape: SKIP_MDWRAP=1.
set -uo pipefail

[ "${SKIP_MDWRAP:-}" = 1 ] && exit 0
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
paths="$(node "$here/lib/payload.mjs" paths 2>/dev/null)" || exit 0
[ -n "$paths" ] || exit 0

# Only this repo's docs; not memory files or other repos. The repo is
# the checkout this script lives in, found with git, not from an
# environment variable only one of the two tools sets. Physical paths,
# every .. and link resolved, before any containment test: a lexical
# .worktrees/p/../../x.md must not pick a worktree or leave the repo.
top="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null)" || exit 0
top="$(realpath "$top" 2>/dev/null)" || exit 0

report=""
fixes=""
while IFS= read -r file; do
  case "$file" in *.md) ;; *) continue ;; esac
  file="$(realpath "$file" 2>/dev/null)" || continue
  root="$top"
  case "$file" in "$root"/*) ;; *) continue ;; esac
  # Match the skipped folders against the repo-relative path: the
  # absolute path may itself sit under /tmp (Linux temp dirs, CI).
  rel="${file#"$root"/}"
  # A plan worktree (DS11) is its own checkout: check the file against
  # that worktree's HEAD and tools, never the canonical checkout's.
  case "$rel" in
    .worktrees/*/*)
      slug="${rel#.worktrees/}"; slug="${slug%%/*}"
      root="$root/.worktrees/$slug"; rel="${rel#.worktrees/"$slug"/}" ;;
  esac
  case "$rel" in
    node_modules/*|*/node_modules/*|.worktrees/*|project/archive/*|tmp/*) continue ;;
  esac
  [ -f "$file" ] && [ -f "$root/kit/scripts/md-wrap.mjs" ] || continue
  out="$(cd "$root" && node kit/scripts/md-wrap.mjs --check --new-only "$rel" 2>&1)" && continue
  report="$report$out
"
  fixes="$fixes  node kit/scripts/md-wrap.mjs \"$rel\"
"
done <<EOF
$paths
EOF

[ -n "$report" ] || exit 0
cat >&2 <<EOF
Markdown prose width (~72): lines you just wrote run long:

$report
Advisory, not a blocker: the write already landed. Reflow with:
$fixes
Not reported, by design: tables, headings, code, front matter, and a
line whose overflow is one unbreakable token (a URL, an inline code
span). Escape: SKIP_MDWRAP=1
EOF
exit 2
