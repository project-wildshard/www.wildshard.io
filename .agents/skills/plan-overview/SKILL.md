---
name: plan-overview
description: Be Jake's plan desk. Show every live plan (docs/plans/) with its true state, check each State line against git and the asks, fix stale ones, archive what is done or what Jake says to archive, rank what to build next, and say what the other agents are on. Use for "/plan-overview", "plan status", "plan overview", "what's ready to archive", "anything almost done", "archive X", "what are the agents working on".
---

# Plan overview

Ported on 2026-11-04 and cut to one repo (no STATE.md files). You are
the desk between Jake and the agents building this repo (its name: the
folder of `git rev-parse --git-common-dir`, as the session brief prints
it). He steers by **plans**; your job is to tell him the truth about
them, briefly, and keep the paperwork true so the session brief is right
for everyone.

Read first: `docs/tasks/asks/README.md` (asks are receipts, plans are
the queue, leftovers are plan rows) and
`.agents/skills/prepare-to-exit/` (pathspec commits, push).

## 1. Gather (from `origin/main`, not the shared working tree)

```bash
git fetch -q origin main
for f in $(git ls-tree --name-only origin/main docs/plans/ | grep '\.md$'); do
  echo "== $f (last $(git log -1 --format='%cs %h' origin/main -- "$f"))"
  git show "origin/main:$f" | grep -m1 -E '^(> *)?(\*\*)?(State|Status):' | cut -c1-400
done
git ls-tree --name-only origin/main project/archive/ 2>/dev/null | tail -15
node kit/scripts/asks.mjs brief            # open asks, expired claims, picks for Jake
```

Other living docs with a `State:` line (`docs/prd.md`, the
wireframes) are context for the plans that cite them, not plans. A
plan from before REPO-KIT K2 may still carry an old `Status:` line.

## 2. Verify before you report: State lines go stale

Agents finish work and forget the State line. For each plan,
compare the line with the evidence:

- the asks it names: `grep -m1 '^\*\*Status' docs/tasks/asks/<ID>.md`;
- commits since its date:
  `git log --oneline --since=<date> origin/main -- <plan> <paths it covers>`
  and `git log --oneline --since=<date> origin/main --grep=<plan name>`;
- its rows: are the ticked ones really built, the open ones really
  open?
- what it says it waits on: has that landed, or been archived?

A line that is demonstrably wrong: rewrite it (don't append), one
true `> **State:**` line with today's date, citing the evidence.
Lead it with one state (the `write-plan` skill): `draft` (being
written; nothing is built from a draft), `ready for review` (waiting
on Jake), `draft, parked` (for review later), `in progress` (names the
open rows and their owners), `held` (names what it waits on), `done`
(every row built, none open). An old `Status:` line becomes a State
line when you rewrite it.
A plan a live session owns: fix only a line that is provably wrong,
never archive it under them. Before editing any file,
`git diff -- <file>`: if it has another agent's uncommitted hunk,
leave it and say so.

For a wide audit (more than ~8 plans), split them across two
subagents with disjoint plan lists, each told the rules above,
"paperwork only, build nothing", and to report a table (old → new
status, evidence, what's open, who it waits on).

## 3. Report: the shape Jake wants

Lead with plans, not the backlog of picks. Group them, one or two
lines each:

1. **Being worked on**: who (herdr agent / session / ask) and the
   next thing.
2. **Almost done**: the exact rows left.
3. **Unowned / free to start**.
4. **Ready for review: waiting on his go or picks**.
5. **Blocked on him**: name the one thing.

Then answer what he asked: "ready to archive" (only when every row is
built, or he says so), "almost complete", the top N. Progress
percentages: count the plan's rows done / total and say they are
rough. Rankings: one recommendation with one line of why, not a
survey.

His standing preferences (from wildshard, 2026-09-28 → 10-03):

- When something truly needs him, give **one recommended option as a
  yes/no** (AskUserQuestion, multiSelect for several plans). Don't
  mint `needs pick` asks by reflex.
- **Never** suggest dropping or parking a plan because it is old or
  idle. Old is not unwanted. Only archive on "every row built" or his
  word.
- If he answers "None", record it and move on; don't re-ask.

## 4. Archive a plan (done, or on his word)

1. On his word: `kit/scripts/ask-new.sh "<his words>"` unless it is part
   of an ask you already hold.
2. `git mv docs/plans/<name>.md project/archive/$(date +%F)-<name>.md`.
3. Rewrite its State line: `> **State:** done, <date>[, archived on
   Jake's word, <ask>: "<his words>"]: <what landed>.` A plan with an
   open row is not done: build the row, or leave the plan live. Never
   file a plan's tail as asks. Rows Jake never picked are dropped in
   the State line, not queued.
4. Fix relative links inside the moved file (one directory deeper
   now: `../tasks/` → `../../docs/tasks/`, and so on).
5. `git grep -n "<name>.md" -- docs project .claude src scripts`:
   repoint live docs and code comments. Ask files keep the old path
   (history).
6. Commit the moved file, its old path, every edited link and the ask
   in one pathspec commit with a journal line, then
   `git push origin main`.

## 5. What the other agents are on

```bash
test "${HERDR_ENV:-}" = 1 && bash .agents/hooks/herdr-peers.sh   # pane, status, goal
herdr agent read <pane> --source visible                          # a working agent's screen
git worktree list; git branch -a                                  # main only (D27), plus plan worktrees where J240 allows
```

Sessions outside herdr show up in ListAgents. Report each agent in a
line or two: plan, what it's building, what it waits on. **Don't
prompt a working agent, and never one that has a question open to
Jake**, unless he asks you to.

## 6. Close the loop

Every ask you claim gets its Status flipped with the commit as
evidence. Read-only answers (rankings, explanations) need no commit.
Keep the status-line label current
(`~/.claude/set-label.sh "<goal>" "<tag>"`).
