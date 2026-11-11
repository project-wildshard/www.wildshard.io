---
name: write-plan
description: Author a new docs/plans/ plan this repo's way — the right name, a Status line with a state, rows with done-when lines, and the judgment no gate can check (grounding in the real tree, citing Jake's words, seams with other agents, real-path verification, sync ripple). Use whenever a session is about to write an implementation plan, or when Jake says "write a plan / plan this out".
argument-hint: "What is being planned? (one line: the outcome the plan lands)"
---

# write-plan

Ported from kami-kakushi's `write-plan` on 2026-11-04. The pre-commit
hook checks only that a **new** plan has a Status line leading with a
state (and warns on its name); this skill supplies the judgment a
regex can't. A plan's real job: hand verified intent from this
session to a cold executor and to Jake, without trampling parallel
work.

## 0. Is it a plan at all?

- A question whose answer is a **decision, not code** → interview Jake
  with the `grill-me` skill; its notes go to `project/brainstorms/`.
- A trivial change → just do it.
- Jake asked for it → file the ask first:
  `f=$(src/scripts/ask-new.sh "<his words>")`, and cite the id in the plan.

## 1. Name and skeleton

`docs/plans/<model>-<YYYY-MM-DD>-<slug>.md`: `<model>` is the running
model's lowercase family (`opus`, `fable`, `sonnet`, `codex`, …, what
your `Assisted-by:` trailer says), the date is today, the slug says
the outcome (`opus-2026-11-04-queue-view.md`).

```markdown
# <Outcome, as a title>

Status: draft <YYYY-MM-DD>: waits on Jake's go. Ask: A<n>. Owner: <who>.

## Why
## Context a fresh executor needs     (big plans: an ordered read list)
## Rows
- [ ] <row>: done when <observable result>
## Seams
## Verification
## Sync
## Open decisions for Jake
```

States, and what they mean: `draft` (waiting on Jake's go; nothing is
built from a draft), `in progress` (names the open rows and owners),
`blocked` (names what it waits on), `finished` (every row built, none
open; then it archives, see the `plan-overview` skill). Rewrite the
line in place as it moves; never append to it.

## 2. The judgment pass (what the hook can't check)

1. **Ground it in the real tree, this session.** Read the files you
   cite; don't quote older docs or memory. Cite paths and commit SHAs
   and say when you surveyed. Where a doc and the code disagree, the
   code wins.
2. **Cite the record in Why.** The ask (`A<n>`), Jake's quoted words,
   the PRD section (`docs/prd.md`) or a decision (`docs/decisions.md`).
   If nothing asks for it, say so: "agent-proposed, no record".
3. **Rows are buildable and checkable.** Each row has a done-when line
   a reviewer can verify. No "investigate X" rows without an output.
4. **Name the seams (shared checkout).** Check `docs/plans/` for live
   plans and `bash .agents/hooks/herdr-peers.sh` for other agents
   (everyone is on `main`: no branches, no worktrees, D27). Say which
   files this plan owns and what must land before or after it.
5. **Verification drives the real path.** Tests use real things: real git
   repositories in temp dirs (never mocked git), `node:test` for logic,
   and a real browser for UI. Name the test, e2e or live run that would
   go red if the plan's outcome broke.
6. **Sync, honestly.** For each of the PRD, living docs in `docs/`,
   `docs/decisions.md` and `AGENTS_SUGGEST.md`: the concrete edit, or
   `none: <reason>`. A reason is a claim the reviewer can check.
7. **Decisions go to Jake as questions,** each with one
   recommendation (the question tool), not as a page he has to read.
   Until he answers, the row they block waits; everything else goes
   ahead.

## 3. Land it

Commit by pathspec with a journal line (`project/journal/`); the hook
refuses a new plan without a state. Then ask Jake for his go with the
question tool. A `draft` becomes `in progress` only on his word.
