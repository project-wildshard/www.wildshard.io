#!/usr/bin/env bash
# PreToolUse(Bash) guard, for Claude Code and Codex alike: read before
# write on herdr. A herdr write into a pane with a question open lands in
# the answer field and answers it for Jake (Jake, 2026-10-12). This
# refuses (exit 2, reason on stderr) a command holding
#   herdr agent prompt|send-keys <target> ...
#   herdr pane send-text|send-keys|run <pane> ...
# unless src/scripts/herdr-question-open.sh calls every target "clear".
# Targets are read with shell quoting, so 'x', "x" and x are the same
# target; a target that does not resolve, a failed status or screen
# read, or a missing or non-executable helper refuses too. Writes from
# a script go through src/scripts/herdr-prompt.sh, which asks the same
# helper. Escape (rare): SKIP_HERDR_GUARD=1 in the command.
#
# The helpers sit at $CLAUDE_PROJECT_DIR/src/scripts/; Codex sets no
# CLAUDE_PROJECT_DIR and runs this from the repo, so git finds it.
set -uo pipefail

input="$(cat)"
case "$input" in *herdr*) ;; *) exit 0 ;; esac

deny() {
  echo "Blocked by guard-herdr-prompt.sh: $1. A herdr write now could answer a question for Jake. Put it in STATE.md or a commit message, or retry later." >&2
  exit 2
}

# Each herdr write in the command, one per line: "<group> <verb>\t<target>",
# or "refuse\t<why>" when a write's target cannot be named.
# shellcheck disable=SC2016 # the JavaScript below is not shell
parser='
const raw = require("fs").readFileSync(0, "utf8");
let cmd = "";
try { const p = JSON.parse(raw); if (typeof p?.tool_input?.command === "string") cmd = p.tool_input.command; } catch {}
if (/SKIP_HERDR_GUARD=1/.test(cmd)) process.exit(0);
const SEP = "\u0000";
function words(src) {
  const out = []; let cur = null; let i = 0;
  const add = (s) => { cur = (cur ?? "") + s; };
  const push = () => { if (cur !== null) out.push(cur); cur = null; };
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { if (src[i + 1] !== "\n") add(src[i + 1] ?? ""); i += 2; continue; }
    if (c === "$" && src[i + 1] === "\x27") { i += 2; let s = ""; while (i < src.length && src[i] !== "\x27") { if (src[i] === "\\" && i + 1 < src.length) { s += src[i + 1]; i += 2; } else s += src[i++]; } i++; add(s); continue; }
    if (c === "\x27") { const end = src.indexOf("\x27", i + 1); const stop = end < 0 ? src.length : end; add(src.slice(i + 1, stop)); i = stop + 1; continue; }
    if (c === "\"") { i++; let s = ""; while (i < src.length && src[i] !== "\"") { if (src[i] === "\\" && "\"\\$`\n".includes(src[i + 1])) { if (src[i + 1] !== "\n") s += src[i + 1]; i += 2; } else s += src[i++]; } i++; add(s); continue; }
    if (c === "\n" || ";&|()`".includes(c)) { push(); out.push(SEP); i++; continue; }
    if (/\s/.test(c)) { push(); i++; continue; }
    add(c); i++;
  }
  push();
  return out;
}
const WRITES = { agent: ["prompt", "send-keys"], pane: ["send-text", "send-keys", "run"] };
const GLOBAL_VALUE = ["--session", "--machine", "--remote"];
const OPTION_VALUE = ["--until", "--timeout"];
const found = [];
function scan(tokens, depth) {
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t === SEP) continue;
    // A command inside a string: bash -c "...", eval "...", or a string that starts with herdr.
    const prev = tokens[k - 1] ?? "";
    if (depth < 4 && /herdr/.test(t) && /\s/.test(t) && (/^-[a-z]*c$/.test(prev) || prev === "eval" || /^\s*(\S*\/)?herdr\s/.test(t))) scan(words(t), depth + 1);
    if (t !== "herdr" && !t.endsWith("/herdr")) continue;
    let j = k + 1; let remote = false;
    while (j < tokens.length && tokens[j] !== SEP && tokens[j].startsWith("-")) { remote = true; j += GLOBAL_VALUE.includes(tokens[j]) ? 2 : 1; }
    const group = tokens[j]; const verb = tokens[j + 1];
    if (!WRITES[group]?.includes(verb)) continue;
    let m = j + 2;
    while (m < tokens.length && tokens[m] !== SEP && tokens[m].startsWith("-")) m += OPTION_VALUE.includes(tokens[m]) ? 2 : 1;
    const target = m < tokens.length && tokens[m] !== SEP ? tokens[m] : "";
    const label = `herdr ${group} ${verb}`;
    if (remote) found.push(`refuse\t${label} names another session or machine, which this guard cannot inspect`);
    else if (!target) found.push(`refuse\t${label} has no target`);
    else if (/[\t\n\0]/.test(target)) found.push(`refuse\t${label} target holds a tab or newline`);
    else found.push(`${group} ${verb}\t${target}`);
  }
}
scan(words(cmd), 0);
process.stdout.write([...new Set(found)].map((line) => line + "\n").join(""));
'
writes="$(printf '%s' "$input" | node -e "$parser" 2>/dev/null)" || deny "the command mentions herdr but could not be parsed (is node on PATH?)"
[ -n "$writes" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
check="$root/src/scripts/herdr-question-open.sh"
for helper in herdr-question-open.sh herdr-prompt.sh; do
  [ -f "$root/src/scripts/$helper" ] && [ -x "$root/src/scripts/$helper" ] \
    || deny "src/scripts/$helper is missing or not executable in $root, so no herdr write can be checked"
done

while IFS=$'\t' read -r what target; do
  [ "$what" = refuse ] && deny "$target"
  why="$("$check" "$target" 2>&1)" && rc=0 || rc=$?
  case "$rc:$why" in
    1:clear*) ;;
    *) deny "$what to $target: ${why:-herdr-question-open.sh exited $rc}" ;;
  esac
done <<<"$writes"
exit 0
