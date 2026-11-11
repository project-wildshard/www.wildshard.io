---
name: improve-codebase-architecture
description: Survey a repo for deepening opportunities, rank them in the chat, then grill through the one Jake picks. User-invoked.
disable-model-invocation: true
---

# Improve codebase architecture

Adapted from Matt Pocock's `improve-codebase-architecture`
(github.com/mattpocock/skills at `4ae2317`, MIT, see LICENSE here) on
2026-11-05.

`lint/`, `docs/process/`, `docs/ENGINE.md`, `docs/HOST-BAR.md`,
`docs/SUBAGENT-BRIEF.md` and `docs/design/mmo/` paths are
singleplayer's (`~/projects/games/wildshard-singleplayer`); "meta" is
`~/projects/games/project-wildshard-meta`.

Find **deepening opportunities**: shallow modules that could become
deep ones, for testability, agent navigation and frame cost. This run
is a survey and changes no code. Its outputs are a ranked list and,
if Jake picks one, a decision.

## 1. Load

Call the Skill tool with `codebase-design`. Use its words in every
candidate, and check every candidate against its **Fit** section.

Use our nouns, and leave settled decisions settled. Read the parts
that touch the area:

- org repos: `docs/design.md`, `docs/decisions.md`, `docs/plans/`;
- singleplayer: `docs/design/mmo/GLOSSARY.md`, `docs/ENGINE.md`,
  `docs/HOST-BAR.md`, `docs/plans/decisions.md`;
- meta repo `docs/plans/multi-repo/`: `MULTI-REPO-PLAN.md` (J-numbers),
  `STATE.md`, `P1-IN-TREE.md`, `LANES-AFTER-SORT.md`,
  `E5-REPLICATION.md`.

## 2. Scope

Deepening pays when the code will change, so decide where to look
before you look.

- If Jake named a direction, take it. "How can we make this next
  thing easy?" is the best form of it.
- Otherwise find the hot spots:
  `git log --since=2.weeks --name-only --format= -- src | grep -v /generators/ | cut -d/ -f1-4 | sort | uniq -c | sort -rn | head -20`.
- In singleplayer also read the debt the tools already count:
  `node scripts/check-engine-sides.mjs --report`, and the
  `mixed: true` tags in `lint/engine-sides.json`.
- Drop what is already queued or owned. A P1 row or a lane's `Owns:`
  line is that lane's work, and features are frozen (J103, J119).
  Mention an overlap instead of proposing it.

## 3. Explore

Spawn one Explore subagent with a fresh context and the scope above
(caps in `docs/process/SUBAGENTS.md`). Have it note friction, and
answer:

- Where does one concept mean bouncing between many small modules?
- Where is an interface nearly as complex as its implementation?
- Where does law live twice, on the client and the server, when it
  could be one `shared/` step like `stepPlayerMotion`?
- Where does a sim and view mix hold back a side?
- Where do modules leak across a seam, or reach around `Transport`,
  `NetRoom` or `SimHost`?
- Where does a hot path pay for an abstraction (allocations per tick,
  call layers per frame)?
- What can only be tested through a browser or a capture?

Apply the **deletion test** to every suspect. Keep what concentrates
complexity when removed; the rest is cleanup, not a candidate.

## 4. Report in the chat

At most five candidates, best first. Write a file only if Jake asks:
then one self-contained HTML page with inline CSS and SVG, no CDN
scripts, in the session scratchpad.

```
1. Name of the deepening [Strong | Worth exploring | Speculative]
   Files:    the modules involved
   Problem:  one sentence: what hurts
   Solution: one sentence: what changes, and on which side
   Wins:     locality, leverage, which tests get simpler
   Category: in-process, local-substitutable, port, or mock
   Fit:      which ratchet falls; lint, budgets and hot-path cost
   Lands:    which repo, and where in the J124 order
```

Add a small before and after sketch where the shape is the point. End
with a **top recommendation** and one sentence on why. If nothing
rises above `Speculative`, say the area is fine and stop.

A candidate that contradicts a J, D or G decision appears only when
the friction justifies reopening it, and names the decision and why.

Propose no interfaces yet. Ask: "Which of these would you like to
explore?" Then stop and wait. If he asked for the report only, you are
done.

## 5. Grill the pick

One candidate per session. Walk the decision tree with Jake: the
constraints, the shape of the module, what sits behind the seam, which
tests survive, what the phone pays.

- Org repos: use the `grill-me` skill.
- Singleplayer has no `grill-me`: ask one question at a time with the
  question tool, option 1 "Skip for now", with your recommendation
  (`AGENTS.md`).

As decisions settle:

- A decision goes in the repo's `docs/decisions.md` as a D-number;
  a cross-repo one goes to Jake as a J-number in `MULTI-REPO-PLAN.md`.
- Work becomes a plan row: `write-plan` in an org repo, meta
  `docs/plans/multi-repo/` for singleplayer, which takes no plan files. The
  refactor runs later, in its own session.
- A rejection with a lasting reason: offer to record it, so the next
  run skips it. Skip reasons like "not now".
- To compare interfaces, use `codebase-design`'s
  [DESIGN-IT-TWICE.md](../codebase-design/DESIGN-IT-TWICE.md).
