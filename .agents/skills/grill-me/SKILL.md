---
name: grill-me
description: Interview Jake relentlessly about a plan, design, or topic, checkpointing every answer to a brainstorm file so nothing is lost. Use whenever interviewing him — "grill me", stress-test / poke holes at a plan or design, brainstorm / think-through / talk-out sessions, a floated idea to develop, or getting what's in his head into a doc.
---

# Grill Me

Ported from kami-kakushi's `grill-me` on 2026-11-04. Relentlessly
interview Jake about every aspect of the topic until you reach shared
understanding, walking down each branch of the decision tree and
resolving dependencies one by one. The real goal is to **get what's in
his head into a durable, organized markdown file**: the file, not your
context, is the source of truth (long interviews fill context;
held-in-head answers get misremembered, conflated or dropped). Never
make him ask you to save progress.

## Setup (before the first question)

1. Create `project/brainstorms/<YYYY-MM-DD>-<topic-slug>.md` (and the
   folder if it's missing). `date +%F` if you don't know the date.
2. Seed it with a header: title, date, the goal of the session, and an
   empty "Open flags" section.
3. Tell Jake where you're saving, in one line. Then ask Q1.

## The checkpoint rule (non-negotiable)

After EVERY answer, BEFORE you ask the next question:

- Append an entry: the question's topic, the facts and decisions from
  his answer (in his words where wording matters), and any flags
  (things he couldn't answer, and who should).
- Update earlier entries if a later answer changes them.
- Only then ask the next question. Never batch several answers into
  one write.

**Write, then speak:** the write that checkpoints an answer is issued
and confirmed BEFORE any prose says "logged" or "captured".

## Interview method

- **One question at a time**, each with your **recommended answer**
  (your best inference from context) so he can confirm, correct or
  redirect. The question tool (AskUserQuestion) works well for this.
- Settle upstream decisions before their dependents.
- If the code, the PRD (`docs/prd.md`), a plan or `docs/decisions.md`
  can answer a question, read it instead of asking.
- When he **can't answer**, record a flag with its owner and move on.
- The moment he floats a **new idea** (not an answer), ask yourself
  2–3 quick questions before developing it: how would this work in
  the current design? What could it conflict with? What might he not
  be seeing? Bring it to him only when it needs his input.
- Put **tangents** under `## Parking lot`, and link them both ways:
  add a bullet to `project/brainstorms/PARKED-THREADS.md` pointing back
  to this file and section, so they can be found in later sessions.
- Keep going until he says you're done or every branch is covered,
  then ask a completeness backstop ("anything we haven't touched?").

## Capture file structure

```
# {Topic}: brainstorm notes
Date: {date} · Goal: {one line}

## Summary / key decisions      (running synthesis, updated as you go)

## Q&A log
### Q1 — {topic}
- Asked: {question}
- Captured: {facts, decisions, in his words where it matters}
- Flags: {open item -> owner}

## Parking lot (tangents / parallel threads)

## Open flags (pending input)
```

## At the end ("we're done" / "wrap it up")

1. Re-read the capture file for contradictions and gaps; reconcile
   them.
2. Promote each settled decision **to both places** (D9 in
   `docs/decisions.md`): the doc it changes (the PRD, a plan, a living
   doc in `docs/`) and a new `D<n>` entry in `docs/decisions.md`,
   quoting him where his words matter. A decision that overrides an
   older one says so, and the older entry gets `Superseded by D<n>`.
   Anything not settled stays explicitly PENDING in the recap; pending
   items are debt, never silent.
3. Work it implies becomes plan rows (the `write-plan` skill), never
   asks.
4. A rule that should shape every future session: propose the line
   for `AGENTS_SUGGEST.md` (AGENTS.md is Jake's to write).
5. Commit one snapshot for the session (capture file, promoted edits,
   a journal line in `project/journal/`) by pathspec.
6. Recap: what's captured, what got promoted, what's still PENDING,
   and the suggested next step.
