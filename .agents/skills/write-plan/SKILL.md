---
name: write-plan
description: Author a new docs/plans/ plan this repo's way — the right name, a State line, rows with done-when lines, and the judgment no gate can check (grounding in the real tree, citing Jake's words, seams with other agents, real-path verification, sync ripple). Use whenever a session is about to write an implementation plan, or when Jake says "write a plan / plan this out".
argument-hint: "What is being planned? (one line: the outcome the plan lands)"
---

# write-plan

Ported from kami-kakushi's `write-plan` on 2026-11-04; its State
wording is meta's (`project-wildshard-meta`
`.agents/skills/write-plan/`, REPO-KIT K2). The pre-commit hook checks
only that a **new** plan has a State line leading with a state (and
warns on its name); this skill supplies the judgment a regex can't. A
plan's real job: hand verified intent from this session to a cold
executor and to Jake, without trampling parallel work.

## 0. Is it a plan at all?

- A question whose answer is a **decision, not code** → interview Jake
  with the `grill-me` skill; its notes go to `project/brainstorms/`.
- A trivial change → just do it.
- A plan that spans several org repos → meta's `docs/plans/`, not here.
- Jake asked for it → file the ask first:
  `f=$(kit/scripts/ask-new.sh "<his words>")`, and cite the id in the plan.

## 1. Name and skeleton

`docs/plans/<model>-<YYYY-MM-DD>-<slug>.md`: `<model>` is the running
model's lowercase family (`opus`, `fable`, `sonnet`, `codex`, …, what
your `Assisted-by:` trailer says), the date is today, the slug says
the outcome (`opus-2026-11-04-queue-view.md`).

```markdown
# <Outcome, as a title>

> Written by: Claude

> **State:** ready for review, <YYYY-MM-DD>. Ask: A<n>.

## Why
## Context a fresh executor needs     (big plans: an ordered read list)
## Rows
| Row | Work | Done when |
|---|---|---|
## Seams
## Verification
## Sync
## Open decisions for Jake
```

States, and what they mean (Jake, 2026-11-07: "we go from draft to
review to build"): `draft` (being written; nothing is built from a
draft), `ready for review` (written, waiting on Jake), `draft, parked`
(written, for review weeks or months later), `in progress` (approved
and building; names the open rows and owners), `held` (names what it
waits on), `done` (every row built, none open; then it archives, see
the `plan-overview` skill). Some plans auto-build with no review step:
say so in the State line. Rewrite the line in place as it moves; never
append to it.

## 2. The judgment pass (what the hook can't check)

1. **Ground it in the real tree, this session.** Read the files you
   cite; don't quote older docs or memory. Cite paths and commit SHAs
   and say when you surveyed. Where a doc and the code disagree, the
   code wins.
2. **Cite the record in Why.** The ask (`A<n>`), Jake's quoted words
   with the date, the PRD section (`docs/prd.md`) or a decision
   (`docs/decisions.md`). If nothing asks for it, say so:
   "agent-proposed, no record".
3. **Rows are buildable and checkable.** Each row has a done-when line
   a reviewer can verify. No "investigate X" rows without an output.
4. **Name the seams (shared checkout).** Check `docs/plans/` for live
   plans and `bash .agents/hooks/herdr-peers.sh` for other agents
   (work is on `main`, or a whole or half plan in `.worktrees/<slug>`
   on `plan/<slug>`, landed by `land`, J290; say which mode). Say which
   files this plan owns and what must land before or after it.
5. **Verification drives the real path.** Tests use real things: real git
   repositories in temp dirs (never mocked git), `node:test` for logic,
   and a real browser for UI. Name the test, e2e or live run that would
   go red if the plan's outcome broke.
6. **Sync, honestly.** For each of the PRD, living docs in `docs/`,
   `docs/decisions.md` and `AGENTS.md`'s agent section: the concrete
   edit, or `none: <reason>`. A reason is a claim the reviewer can
   check.
7. **Decisions go to Jake as questions,** each with one
   recommendation (the question tool), not as a page he has to read.
   Until he answers, the row they block waits; everything else goes
   ahead.

## Rows are lane-sized

Each row is one lane's whole job: one agent builds it in under an hour
and under 300 turns, then stops (Jake, 2026-11-11). If a row needs
more, split it. A coordinator briefs one row per fresh agent, so a
row's done-when line must be checkable without the history of the rows
before it.

## 3. Land it

Commit by pathspec with a journal line (`project/journal/`); the hook
refuses a new plan without a state. Then ask Jake for his go with the
question tool. A plan becomes `in progress` only on his word.
