#!/usr/bin/env bash
# PostToolUse(Edit|Write) advisory: markdown prose wraps at ~72 chars
# (Jake's norm). Ported from kami-kakushi's md-prose-width.sh.
#
# A hook, not a gate: tables, long URLs and code spans legitimately run
# long, and a red commit over a soft norm trains everyone to bypass it.
# The long lines are born in agent edits, so that is where to say so.
# It reports and never rewrites (a rewrite would break the agent's next
# Edit, whose old_string must match), and only lines added vs HEAD.
#
# Reads the PostToolUse JSON on stdin. Exit 2 + stderr = advice shown to
# the agent (the write already happened). Exit 0 = clean or not
# applicable. Escape: SKIP_MDWRAP=1.
set -uo pipefail

[ "${SKIP_MDWRAP:-}" = 1 ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
file="$(jq -r '.tool_input.file_path // empty' 2>/dev/null)"
case "$file" in *.md) ;; *) exit 0 ;; esac

# Only this repo's docs; not memory files, other repos or agent worktrees.
root="${CLAUDE_PROJECT_DIR:-}"
[ -n "$root" ] || exit 0
case "$file" in "$root"/*) ;; *) exit 0 ;; esac
# Match the skipped folders against the repo-relative path: the absolute
# path may itself sit under /tmp (Linux temp dirs, CI sandboxes).
rel="${file#"$root"/}"
case "$rel" in
  node_modules/*|*/node_modules/*|.claude/worktrees/*|project/archive/*|tmp/*) exit 0 ;;
esac
[ -f "$file" ] && [ -f "$root/src/scripts/md-wrap.mjs" ] || exit 0

cd "$root" || exit 0
out="$(node src/scripts/md-wrap.mjs --check --new-only "$rel" 2>&1)" && exit 0

cat >&2 <<EOF
Markdown prose width (~72): lines you just wrote run long:

$out

Advisory, not a blocker: the write already landed. Reflow with:
  node src/scripts/md-wrap.mjs "$rel"
Not reported, by design: tables, headings, code, front matter, and a
line whose overflow is one unbreakable token (a URL, an inline code
span). Escape: SKIP_MDWRAP=1
EOF
exit 2
