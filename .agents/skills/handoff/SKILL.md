---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Handoff

Ported from kami-kakushi's `handoff` (itself kept close to
[mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/productivity/handoff))
on 2026-11-04. Two adaptations for this repo:

1. **Where it goes:** the repo's git-ignored `./tmp/`, as
   `tmp/handoff-<YYYY-MM-DD>-<slug>.md`. Not the OS temp dir, not the
   session scratchpad, and never committed.
2. **What it is not:** a handoff is a transient brief for one fresh
   agent and one continuation. It does not replace the durable record:
   the plans (`docs/plans/`), the asks (`docs/tasks/asks/`), the
   journal (`project/journal/`) and the commits. Progress that matters
   goes there first; the handoff points at it by path. To *end* a
   session safely, use `prepare-to-exit`; use this when the work
   continues elsewhere.

Write a handoff document summarising the current conversation so a
fresh agent can continue the work. Save it to `tmp/` as above and
print its path.

Include:

- **Goal and state:** what the work is for, what is done (with SHAs),
  what is in progress and exactly where it stopped.
- **Open asks and plan rows** this work touches, by id and path.
- **Uncommitted files** that belong to this work (`git status`), and
  which uncommitted files belong to other agents and must be left
  alone.
- **Other agents** still working in the repo
  (`bash .agents/hooks/herdr-peers.sh`) and what they hold. Any
  branch or worktree is a D27 violation: name it.
- **Decisions Jake made** in this conversation that aren't written down
  yet (then also record them: `docs/decisions.md`).
- **Suggested skills** the next agent should invoke (e.g.
  `prepare-to-exit`, `plan-overview`, `write-plan`, `grill-me`).

Do not duplicate content already captured in other artifacts (the PRD,
plans, asks, decisions, the journal, commits, diffs). Reference them by
path or SHA instead.

Redact any sensitive information, such as API keys, tokens, passwords
or personally identifiable information.

If the user passed arguments, treat them as a description of what the
next session will focus on and tailor the doc accordingly.
