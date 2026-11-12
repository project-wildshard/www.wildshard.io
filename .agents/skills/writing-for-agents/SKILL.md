---
name: writing-for-agents
description: Writing documents agents read. Use when creating or editing a skill, a plan, a lane brief or a steering line.
---

# Writing for agents

Adapted from Matt Pocock's `writing-for-agents`
(github.com/mattpocock/skills at `4ae2317`, MIT, see LICENSE here) on
2026-11-05.

Paths are this repo's own unless a repo is named. "Meta" is
`~/projects/games/project-wildshard-meta`; "engine" is
`~/projects/games/wildshard/engine`.

One reference for a skill, a plan, a brief, a doc behind a pointer. A
good document makes the agent take the same **process** every run.

## How we write here

- **Short.** `AGENTS.md`'s headings show the shape: a topic, a pointer
  to the doc, and a few rules (`- Commands, layout: docs/dev.md`).
- **Cite the decision instead of arguing it.** J-numbers are Jake's
  cross-repo decisions (meta
  `docs/plans/multi-repo/MULTI-REPO-PLAN.md`), D-numbers a repo's
  `docs/decisions.md`, and M1, R2, B1 are the MMO requirements (meta
  `docs/README.md` links them). "Features frozen (J103, J119)" is a
  whole rule.
- **Quote Jake when his wording is the rule**, with the date: (Jake,
  2026-11-05: *"…"*). Keep every quote exact; a paraphrase carries no
  authority.
- **Open a doc with its state**: `> Written by: Claude`, then
  `> **State:** draft, 2026-11-05.` Plans use the `State:` line
  `write-plan` describes.
- **Cite other repos by repo, path and commit.** Lanes move every
  repo hourly, so a fact read there carries its SHA. Mark
  `*(estimate)*` for anything unmeasured and `*(inference)*` for your
  reading of code.
- **A brief or a plan row ends on a done-when line.** A lane brief
  also says `Owns:` and `Must not touch:`, and carries its stop caps:
  one row, under 1 hour and 300 turns (Jake, 2026-11-11).
- **`README.md` and `AGENTS.md` above its marker are Jake's.**
  Agents write steering below the marker (J241). Leave `CLAUDE.md` as
  `@AGENTS.md`.
- **MMO facts stay in their docs.** Point at them; a copied budget or
  a copied rate goes stale.
- **Wrap** markdown at 72 (`src/scripts/md-wrap.mjs`).

## Pointers

A **pointer** is a line in context that names out-of-context material
and says when to reach it: a skill description, an `AGENTS.md` line.
Its wording decides whether the agent gets there. If a must-read gets
skipped, sharpen the pointer first, and inline only if that fails.

- Front-load the leading word.
- One trigger per distinct case. Synonyms are one case written twice.
- Cut identity the body already carries.

## The two loads

- **Context load**: always-loaded text costs every agent every turn.
  Our sessions run long and lanes run ten at a time, so this one is
  paid many times over.
- **Cognitive load**: what Jake must remember exists. Spend it where
  his judgement matters.

Material behind a pointer costs only the pointer's line.

## Hierarchy

Rank material by how soon the agent needs it:

1. Steps in the file: what to do, in order.
2. Reference in the file: facts consulted on demand.
3. Reference behind a pointer: a sibling file or a doc.

Inline what every branch needs, and push down what only some branches
reach. Keep a concept's definition, rules and caveats together.
**Sprawl** is the failure: when a document grows, attention thins even
if every line is true.

## Completion criteria

Every step ends on a condition that separates done from not done.

- **Clear**: "understanding reached" invites **premature completion**.
  Sharpen the bound first.
- **Demanding**: "every changed hook has a case in
  `.githooks/*.test.mjs`" forces work that "test the hooks" does
  not. Checkable and exhaustive is the strongest form.

## Leading words

A **leading word** is a compact concept the agent thinks with. Repeat
the token, keep the definition in one place. Prefer a word the model
already knows; ours also carry repo meaning: *law*, *seam*, *port*,
*side*, *lane*, *ratchet*, *oracle*, *product*, *host bar*. Hunt for a
sentence that could collapse into one.

**Negation** backfires: a ban puts the banned thing in the agent's
mind. State the target ("commit by pathspec"). Keep a ban
only for a hard guardrail, paired with the positive.

## Pruning

- **One source of truth.** Each meaning lives in one place. The plan
  owns the decision, `STATE.md` the status, the commit the detail.
- **The environment is a source of truth too.** A document that restates
  `package.json` or the lint config is a cache that goes stale. Write
  down what looking cannot find: the reason, the gotcha, Jake's words.
- **Relevance.** Without pruning, documents collect **sediment**:
  retired locks and renamed paths nobody dares remove.
- **No-ops.** If a sentence doesn't change behaviour against the
  default, delete the whole sentence. A word too weak to beat the
  default (*thorough*) wants a stronger word (*relentless*).

## Skills

- A **model-invoked** skill has a description in every session: use
  it when the agent or another skill must reach it. Its description is
  a pointer, so the rules above apply in full.
- A **user-invoked** skill sets `disable-model-invocation: true`: no
  context load, a one-line human description, and only Jake can fire
  it.
- Reference two user-invoked skills share lives in a model-invoked
  skill or a plain doc, since neither can call the other.
- A skill is one directory in `.agents/skills/<name>/` (Codex reads
  it there); `.claude/skills/<name>` is a symlink to it for Claude.
  Kit skills come from repo-kit (`scripts/agent-sync.mjs`,
  `docs/agent-parity.md`); never copy one by hand.
