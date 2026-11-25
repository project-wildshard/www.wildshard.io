#!/usr/bin/env bash
# PreToolUse(Bash) guard, for Claude Code and Codex alike: read before
# write on herdr-core (`hc`). A write into a terminal with a question or
# approval open answers it for Jake (Jake, 2026-10-12). `hc send` already
# refuses a `blocked` terminal (exit 9), so this refuses (exit 2, reason
# on stderr) only what hc lets through:
#   hc send --force <t> ...       types even into a blocked terminal
#   hc keys <t> ...               keys answer a dialog (down enter)
#   hc interrupt <t>              its stop key can dismiss one
# unless `hc get <t>` reads the target as live and not blocked.
#
# The command is read as bash runs it: every command substitution the
# shell would run, $(...) or backticks, bare or inside double quotes, is
# a command too; inside single quotes it is text, until that string is
# itself run (bash -c '...', eval, watch). Text a command only prints
# (echo "hc keys t7 enter", grep, printf) is not a write.
set -uo pipefail

input="$(cat)"
case "$input" in *hc*) ;; *) exit 0 ;; esac

deny() {
  echo "Blocked by guard-hc-send.sh: $1. A write now could answer a question for Jake. Put it in STATE.md or a commit message, or retry later." >&2
  exit 2
}

# Each checked hc write in the command, one per line: "<verb>\t<target>",
# or "refuse\t<why>" when a write's target cannot be named.
# shellcheck disable=SC2016 # the JavaScript below is not shell
parser='
const raw = require("fs").readFileSync(0, "utf8");
let cmd = "";
try { const p = JSON.parse(raw); if (typeof p?.tool_input?.command === "string") cmd = p.tool_input.command; } catch {}
if (/SKIP_HC_GUARD=1/.test(cmd)) process.exit(0);
const SEP = "\u0000";
const Q = "\x27";
// Where a span ends, read as bash reads it: the index of its closing ` or " or ).
function endTick(src, i) { while (i < src.length && src[i] !== "`") i += src[i] === "\\" ? 2 : 1; return i; }
function endDouble(src, i) {
  while (i < src.length && src[i] !== "\"") {
    if (src[i] === "\\") i += 2;
    else if (src[i] === "$" && src[i + 1] === "(") i = endParen(src, i + 2) + 1;
    else if (src[i] === "`") i = endTick(src, i + 1) + 1;
    else i++;
  }
  return i;
}
function endParen(src, i) {
  let depth = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") i += 2;
    else if (c === Q) { const end = src.indexOf(Q, i + 1); i = end < 0 ? src.length : end + 1; }
    else if (c === "\"") i = endDouble(src, i + 1) + 1;
    else if (c === "`") i = endTick(src, i + 1) + 1;
    else { if (c === "(") depth++; else if (c === ")" && --depth === 0) return i; i++; }
  }
  return i;
}
// A backtick body loses the backslash before \\ ` $ and ".
const untick = (body) => body.replace(/\\([\\`$"])/g, "$1");
// Shell words of one command, plus every command substitution the shell
// would run in it. A substitution stays in its word as written, so a
// target made of one never resolves.
function words(src) {
  const out = []; const subs = []; let cur = null; let i = 0;
  const add = (s) => { cur = (cur ?? "") + s; };
  const push = () => { if (cur !== null) out.push(cur); cur = null; };
  // The substitution starting at i: its body in subs, its end index back.
  const sub = (i) => {
    if (src[i] === "`") { const end = endTick(src, i + 1); subs.push(untick(src.slice(i + 1, end))); return end; }
    const end = endParen(src, i + 2); subs.push(src.slice(i + 2, end)); return end;
  };
  const opens = (i) => src[i] === "`" || (src[i] === "$" && src[i + 1] === "(");
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { if (src[i + 1] !== "\n") add(src[i + 1] ?? ""); i += 2; continue; }
    if (opens(i)) { const end = sub(i); add(src.slice(i, end + 1)); i = end + 1; continue; }
    if (c === "$" && src[i + 1] === Q) { i += 2; let s = ""; while (i < src.length && src[i] !== Q) { if (src[i] === "\\" && i + 1 < src.length) { s += src[i + 1]; i += 2; } else s += src[i++]; } i++; add(s); continue; }
    if (c === Q) { const end = src.indexOf(Q, i + 1); const stop = end < 0 ? src.length : end; add(src.slice(i + 1, stop)); i = stop + 1; continue; }
    if (c === "\"") {
      i++; let s = "";
      while (i < src.length && src[i] !== "\"") {
        if (src[i] === "\\" && "\"\\$`\n".includes(src[i + 1])) { if (src[i + 1] !== "\n") s += src[i + 1]; i += 2; }
        else if (opens(i)) { const end = sub(i); s += src.slice(i, end + 1); i = end + 1; }
        else s += src[i++];
      }
      i++; add(s); continue;
    }
    if (c === "\n" || ";&|()".includes(c)) { push(); out.push(SEP); i++; continue; }
    if (/\s/.test(c)) { push(); i++; continue; }
    add(c); i++;
  }
  push();
  return { tokens: out, subs };
}
// hc verbs that write to a terminal: send is checked by hc itself unless forced.
const CHECKED = new Set(["keys", "interrupt"]);
const OPTION_VALUE = ["--if", "--timeout"];
// Commands that run a string argument as a command, and commands that only print or search their arguments.
const RUNS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish", "eval", "watch", "ssh", "su", "script"]);
const PRINTS = new Set(["echo", "printf", "grep", "egrep", "fgrep", "rg"]);
const HC = /(^|[^\w.-])hc(\s|$)/;
const found = [];
function scan(src, depth) {
  if (!HC.test(src)) return;
  if (depth > 8) { found.push("refuse\tthe command nests hc deeper than this guard reads"); return; }
  const { tokens, subs } = words(src);
  for (const body of subs) scan(body, depth + 1);
  let head = -1;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t === SEP) { head = -1; continue; }
    if (head < 0) { if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue; head = k; }
    const name = tokens[head].replace(/^.*\//, "");
    const prints = PRINTS.has(name);
    // A string the shell hands on as a command: bash -c "...", eval "...", watch "...", or one that starts with hc.
    const prev = tokens[k - 1] ?? "";
    if (k !== head && HC.test(t) && /\s/.test(t) && (/^-[a-z]*c$/.test(prev) || RUNS.has(name) || (!prints && /^\s*(\S*\/)?hc\s/.test(t)))) scan(t, depth + 1);
    if (prints || (t !== "hc" && !t.endsWith("/hc"))) continue;
    const verb = tokens[k + 1];
    if (verb !== "send" && !CHECKED.has(verb)) continue;
    let m = k + 2; let force = false;
    while (m < tokens.length && tokens[m] !== SEP && tokens[m].startsWith("-")) { if (tokens[m] === "--force") force = true; m += OPTION_VALUE.includes(tokens[m]) ? 2 : 1; }
    const target = m < tokens.length && tokens[m] !== SEP ? tokens[m] : "";
    for (let n = m + 1; n < tokens.length && tokens[n] !== SEP; n++) if (tokens[n] === "--force") force = true;
    const label = `hc ${verb}`;
    if (verb === "send" && !force) continue;
    if (verb === "send") found.push(`refuse\thc send --force types into a blocked terminal; ask Jake instead`);
    else if (!target) found.push(`refuse\t${label} has no target`);
    else if (/[\t\n\0]/.test(target)) found.push(`refuse\t${label} target holds a tab or newline`);
    else found.push(`${label}\t${target}`);
  }
}
scan(cmd, 0);
process.stdout.write([...new Set(found)].map((line) => line + "\n").join(""));
'
writes="$(printf '%s' "$input" | node -e "$parser" 2>/dev/null)" || deny "the command mentions hc but could not be parsed (is node on PATH?)"
[ -n "$writes" ] || exit 0
command -v hc >/dev/null 2>&1 || deny "hc is not on PATH, so its targets cannot be read"
command -v jq >/dev/null 2>&1 || deny "jq is not on PATH, so hc's answers cannot be read"

while IFS=$'\t' read -r what target; do
  [ "$what" = refuse ] && deny "$target"
  got="$(hc get "$target" 2>/dev/null)" || deny "$what to $target: hc cannot read $target (not found, or hc is down)"
  read -r state status <<<"$(jq -r '[(.state // "?"), ((.status | if type == "object" then .state else . end) // "none")] | @tsv' <<<"$got" 2>/dev/null)"
  case "$state:$status" in
    live:blocked) deny "$what to $target: $target is blocked (a question or approval is open)" ;;
    live:*) ;;
    "?:"* | ":"*) deny "$what to $target: hc's record for $target could not be read" ;;
    *) deny "$what to $target: $target is $state, not live" ;;
  esac
done <<<"$writes"
