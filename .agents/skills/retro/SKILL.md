---
name: retro
description: Review a coding session and rank candidate changes to the agent's environment. User-invoked.
disable-model-invocation: true
---

# Retro

Adapted from Matt Pocock's `retro` (github.com/mattpocock/skills at
`4ae2317`, MIT, see LICENSE here) on 2026-11-05.

Paths are this repo's own unless a repo is named. "Meta" is
`~/projects/games/project-wildshard-meta`; "engine" is
`~/projects/games/wildshard/engine`.

Suggest changes to the agent's **environment** so the next run goes
better: checks, pointers, tools, access. The session's code is someone
else's job. Every candidate traces to a **moment** in the record: a
quote, a command, a SHA. A session with few moments gets a short
report, and that is a good result.

## Steps

1. Call the Skill tool with `writing-for-agents`.
2. Find the session Jake named; default to the current one.
3. Read the record for moments (below). Done when you have checked
   Jake's own messages, the failed calls and every subagent's brief
   and final report.
4. Walk the **seven categories** and the **failure modes**. Read the
   repo's real gate first (`pnpm check`, `.githooks/`, the CI
   workflow): a check that exists but sits unwired is the finding,
   not a new check.
5. Report in the chat, worst first (format below). Write no file
   unless Jake says so.
6. Ask which to apply, and stop. Nothing changes until he picks.

## Reading the record

Logs live in `~/.claude/projects/<encoded path>/`:

```sh
dir=~/.claude/projects/$(git rev-parse --show-toplevel | sed 's#[^a-zA-Z0-9]#-#g')
ls -lht "$dir"/*.jsonl | head -5
```

- `<session>.jsonl` is the main log, one JSON object per line. Logs
  here reach 5 GB and single lines reach megabytes, so check the size
  first and read with `grep -c`, `grep -o`, `cut` and `tail -c`. Keep
  every read out of `cat` and the Read tool.
- `<session>/subagents/agent-*.jsonl` are the lanes, with a
  `.meta.json` naming each one. `<session>/tool-results/` holds big
  outputs. Jake's sessions fan out, so most of the work is here.
- A coordinator run from `project-wildshard-meta` logs under the meta
  folder even when its lanes edit another repo. Find a session by a
  phrase from it: `grep -l '<phrase>' "$dir"/*.jsonl`. Search the
  small and recent files first.

```sh
f=<session>.jsonl
# Jake's words, then what he had to repeat or correct
grep '"type":"user"' "$f" | grep -v '"tool_use_id"' | grep -v '"isMeta":true' |
  grep -v task-notification | jq -r '.timestamp[0:16] + " " +
  (.message.content | if type=="string" then . else
  (map(.text? // "") | join(" ")) end)[0:200]'
# failed calls and hook refusals
grep -c '"is_error":true' "$f"
grep -oE '.{0,200}"is_error":true' "$f" | cut -c1-240 | tail -30
grep -oE 'BLOCKED by [^"\\]{0,100}' "$f" | sort | uniq -c | sort -rn
# tool spend
grep -oE '"type":"tool_use","id":"[^"]*","name":"[^"]*"' "$f" |
  sed 's/.*"name"://' | sort | uniq -c | sort -rn
```

## The seven categories

- **Navigation**: a long hunt for a file or fact. Fix with a pointer
  from a file the agent already reads. Facts split across repos, so
  a stale path or a fact that lives only in the meta repo counts.
- **Automated checks**: a mistake a tool could have caught. A repo
  with no gate on that class of mistake is itself a finding.
- **Coding standards**: a broken rule. Classify it first. A
  **mechanical** one (banned API, import shape, file location, a count
  that may only fall) gets a lint rule, hook or ratchet. A **judgement
  call** gets a line in the living doc that owns the subject, read at
  review, where context pressure is lowest: `docs/dev.md`,
  `docs/design.md`, `docs/decisions.md`. Default to the check. We keep
  no standards file and no reviewer agent.
- **Global AGENTS.md**: steering that belongs in a check or a doc, in
  the repo's file or Jake's `~/.claude/CLAUDE.md`. These are
  suggestions for Jake (see "Where a fix lands").
- **Tool economy**: expensive calls. Whole-file reads, a full suite
  where a focused test would do, subagents past their caps (they were
  92% of the usage that burned a weekly limit), long polls, a custom
  tool with noisy output.
- **No-ops**: steering lines that change nothing, or that describe a
  retired thing. Test: would an agent act differently without it?
- **Information access**: what the agent needed and could not reach. A
  CI verdict, a deploy log, a phone reading, read-only access to a
  service, the state of another lane.

## Our failure modes

Look for these first. They recur, and each already has a fix shape.

| Failure | The moment | Fix shape |
|---|---|---|
| CI cancelled by pushers | The `prepare` group keeps one pending run: 35 of 80 push runs were cancelled, so a red spans several lanes' commits | A red names the SHA range since the last finished run |
| Lanes in one working tree | Another lane's dirty file broke your typecheck, or a commit swept up its work | Narrower gate, pathspec commits, disjoint `Owns:` lines in the briefs |
| Ratchets | A count was raised to go green, or a red push said "Ratchet rose" | Fix the code; the list only falls; policy lists need the coordinator |
| Frozen oracles | A path rewrite changed a provenance string in a frozen oracle and its hash pin refused | Codemods skip oracles; a check names them |
| Stale products | A test or capture read old generated or cooked output | Key on inputs; a freshness check at the gate |
| Green on the Mac only | A Mac number stood in for the phone, or a compare is skipped off macOS (Pine and Far Reach drift) | A real-path check; phone readings per J121 |
| Wire or law drift | Client and server disagreed, or `NET_SCHEMA_HASH` moved unnoticed | One law in `shared/`, a trace oracle |
| Brief lost at a hand-off | A subagent redid mapped work, or broke a rule the brief left out | A line in the lane brief, or a guard hook |
| Kit edited in a clone | A hook fixed in one repo, then `diverged` at the next sync | Fix it in repo-kit (`docs/repo-kit.md` there) |

## Report

One block per candidate, worst first. Severity is cost times how often
it will recur: a red `main` or lost work across lanes outranks a slow
search. A quiet, expensive mistake outranks a loud, cheap one.

```
1. [category] The change, in one line
   Moment: the quote, command or SHA, with a time
   Lands in: the file, hook or list; who applies it
   Cost: what it adds, and how it could fire on good work
```

Drop any candidate with no moment. Leave a category out when it has
nothing, and say so if the session was clean.

## Where a fix lands

| Fix | Where |
|---|---|
| Lint, hook, ratchet | Kit-owned files (`.githooks/`, the agent hooks, `kit/.oxlintrc.json`, `kit/scripts/`) change in repo-kit; the repo's own checks change in place |
| `AGENTS.md`, `README.md` | `README.md` and `AGENTS.md` above its marker are Jake's: propose the line in the chat. Agents edit below the marker (J241) |
| Follow-up work | A row in `docs/plans/` |

A proposed check is code: try it on the repo before it can block a
commit. Retro sees one session, so it cannot tell you a rule now
fires too often. When Jake says a check blocks good work, propose its
removal.
