# Asks

Ported from project-wildshard-singleplayer's `docs/process/ASKS.md`
(Jake's E423 rules) on 2026-11-04. `kit/scripts/asks.mjs` enforces them in
`.githooks/pre-commit` and prints open asks in the session brief.

## An ask is a receipt; plans are the queue

- **An ask file records a request for work from Jake**: a change or a
  deliverable. Create it before you start:
  `f=$(kit/scripts/ask-new.sh "<Jake's words>")`, and use the id it
  prints. A question answered in chat gets no file. Steering inside a
  running job is appended to that job's ask.
- **It closes when the work lands.** Follow-up work is a **row in a
  live plan** (`docs/plans/`), never another ask. There is one queue,
  and it is the plans. (Wildshard's audit found 133 open asks, 86 of
  them finished, dead or duplicated, because every leftover became an
  ask.)
- **Done means on `origin/main` with the hooks green.** Don't wait
  for CI.
- Ask files never move and are never deleted; they are the history.

## The file

```markdown
# A7

**Status:** in flight (2026-11-04, www.wildshard.io-99)
**Ask:** "Can we setup docs/tasks/asks in this repo ?"

Notes, steering, outcome: commits, what landed, what became a plan row.
```

Line 1 is `# <ID>`, matching the file name. IDs are `A1`, `A2`, … in
claim order; `ask-new.sh` claims one atomically (two agents can't get
the same id). **Ask:** is Jake's own words, quoted, shortened only if
long.

## Status vocabulary

| Status | Meaning |
|---|---|
| `open (YYYY-MM-DD)` | received, not started |
| `in flight (YYYY-MM-DD, <owner>)` | claimed. **The lease is 71 h**: with no commit touching the file in 71 h, the brief shows `CLAIM EXPIRED` and anyone may take the work. Owner = herdr agent or session name |
| `needs pick (YYYY-MM-DD)` | waits on a decision from Jake. It **never expires**: the brief shows `ASK JAKE`, and the next session asks it with the question tool until he answers |
| `done (YYYY-MM-DD): <commits / evidence>` | landed on `origin/main` |
| `dropped (YYYY-MM-DD): <why>` | won't happen, in Jake's words |
| `folded into <ASK or plan>` | another ask or plan carries it; the target must exist |
| `superseded by <ASK or plan>` | replaced by it |

Nothing else: no `parked`, `paused`, `blocked` or `answered`.

## Leftovers and picks

- Something you found, deferred or didn't finish is **built in the
  session that found it**. If it truly can't land, it becomes an open
  row of the live plan it belongs to, and you say so in chat. **Never
  a new ask.**
- **Decisions for Jake** go to him with the question tool
  (AskUserQuestion: context, the trade-offs, one recommendation),
  never as a decision page. Collect them and ask at the end of a job.
  The ask waits as `needs pick` until he answers.
- **Agent-to-agent requests** go over herdr / SendMessage to the
  owning agent, who replies with the SHA. Never an ask.
