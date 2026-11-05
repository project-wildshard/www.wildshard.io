---
name: prepare-to-exit
description: Checkpoint the session and prepare to exit — pathspec-commit only your paths with a journal entry, let the hooks gate HEAD, push, flip your ask files and make plan Status lines true, queue every leftover as a plan row, close what you started, clean scratch, report, then print the BYE / OOPS banner. User-invoked only.
disable-model-invocation: true
---

# Prepare to exit

Ported from project-wildshard-singleplayer's `prepare-to-exit` on
2026-11-04 and cut down to this repo: no deploy, no push lock, no
browser lane. AGENTS.md is canon; where this file and
AGENTS.md disagree, AGENTS.md wins and this file is the bug. Execute
in order; don't paraphrase or shortcut.

## What is different here

- **One checkout, one index, several agents.** Other Claude sessions
  (herdr panes) and their subagents edit this tree on `main`. Main
  only: no branches, no worktrees (D27; pre-commit enforces it).
  Nothing you do may snapshot the shared index: commit by pathspec
  only.
  `.claude/hooks/guard-git-add.sh` blocks `git add -A/./-u`,
  `git commit -a` and a bare `git commit`.
- **The hooks are the gate.** `.githooks/` (on when
  `git config core.hooksPath` prints `.githooks`) checks the message,
  the staged blobs, the journal entry and, once `package.json` exists,
  lint / format / typecheck at commit and the full `pnpm check` at
  push. A bypass flag (`SKIP_*`, `ALLOW_*`) is for the case it names,
  never for a red gate.
- **The exit is local.** Push and you are done. Don't wait for the
  GitHub Actions run (no `gh run watch`); a red run someone sees gets
  fixed then.

## Steps

1. **Commit only your paths.** `git config core.hooksPath` must print
   `.githooks` (else run `git config core.hooksPath .githooks`). Then
   `git status`: list exactly which paths you and your subagents
   authored this session.
   - Append a line or two to the journal (`project/journal/`, see its
     README): what you did and why. Informal.
   - Edits to tracked files are never staged; commit them directly.
     New files: `git add path/new` first. Then
     `git commit -m "<subject>" -m "<why>" -m "Assisted-by: …" -- paths`.
     `git show --stat HEAD` must list only your paths; if it doesn't,
     stop and say so. Never `reset` to fix it.
   - **A shared file with someone else's hunks** (`git diff -- <path>`
     shows lines you didn't write): a pathspec commit would ship their
     half-done work. Ask the owner over herdr / SendMessage to commit
     first, or leave yours uncommitted and say so in the report.
   - Subject `type(scope): summary`, ≤ 50 chars; body wrapped at 72;
     final `Assisted-by: Claude Code:<actual model>`. Never
     `Co-Authored-By:` for an AI. The commit-msg hook refuses the rest.
2. **Gates green on HEAD.** The pre-commit lane ran on your staged
   files. If you touched `.githooks/` or `.claude/hooks/`, the hook
   suite ran too (`pnpm test:hooks` / `node --test
   .githooks/*.test.mjs` by hand). Red on your commit: fix it forward
   with a new pathspec commit (never `--amend` a pushed commit, never
   revert to hide it). Red on someone else's commit: name the commit
   and its owner in the report.
3. **Push, and stop there.** `git push origin main`; pre-push re-scans
   the outgoing commits and runs the full `pnpm check`. Rejected
   (non-fast-forward): `git fetch origin && git merge origin/main`
   (never rebase or stash a shared `main`), then push again.
   `git log origin/main..main` empty = shipped. An unpushed commit of
   yours at exit is an OOPS.
4. **Asks and plans tell the truth** (rules:
   `docs/tasks/asks/README.md`). Every request for work Jake made this
   session has its `docs/tasks/asks/<ID>.md` (claimed with
   `src/scripts/ask-new.sh "<his words>"`), and its `**Status:**` is true:
   `done (<date>): <SHAs>` once it is on `origin/main`,
   `in flight (<date>, <owner>)`, `needs pick (<date>)` naming exactly
   what he must choose, `dropped (<date>): <his words>`, or
   `folded into <X>`. A `done` ask whose push isn't on `origin/main`
   goes back to step 3. Ask files never move or get deleted.
   Every plan you moved (`docs/plans/*.md`)
   has its rows ticked and its `Status:` line rewritten, not appended,
   to the current truth. A plan that finished moves to
   `project/archive/` in the same commit, links fixed; a plan with an
   open row is not finished.
5. **Leftover work: build it, or it is a plan row, never a new
   ask.** Anything this session found, deferred or didn't finish is
   built now. If it truly
   can't land, it becomes an open row (with a done-when line) of the
   live plan it belongs to, and the report says so. A commit body, a
   journal line, a subagent report, a memory note or a chat message is
   a RECORD, not a QUEUE. A pick only Jake can make goes to him with
   the question tool (context, one recommendation) *before* this
   skill, not on the way out. This is the step most likely to be
   skipped because everything *looks* clean; it is a banner
   precondition.
6. **Close what you started; empty your scratch.** Every process you
   started, by PID: `pnpm dev`, Playwright and
   agent-browser sessions, background watchers. Never kill a server or
   browser someone else owns. Then delete your scratch with literal
   paths (`rm -rf ./tmp/<task>`, your session scratchpad's big files);
   keep only small text the report links to. Never rename aside
   instead of deleting.
7. **Agents and worktrees.** Don't kill running subagents to exit.
   List every agent still alive (ListAgents; in herdr,
   `bash .claude/hooks/herdr-peers.sh`) and what it holds. Main only
   (D27): if the brief's main-only section shows a branch or worktree
   you or your subagents made, land its work on `main`, `git worktree
   remove` it, and name the branch in the report for Jake to delete
   (dcg blocks agents from deleting branches). Never remove someone
   else's worktree. A subagent's WIP that nobody will finish is an
   OOPS.
8. **Memory.** If this session learned something the next one must
   know that the repo does not record (a tool gotcha, a rule of
   Jake's, a decision's why), write it to this project's memory
   directory and index it in `MEMORY.md`. Don't duplicate AGENTS.md,
   a plan or a commit.
9. **Report**, then the banner. The report names: commits (SHAs + one
   line each), gate results, what is left local (yours vs others'
   WIP), every live agent and worktree, every ask this session touched
   and its Status, plans whose Status changed,
   leftovers and the plan rows that hold them, processes closed, and
   scratch left — so Jake knows whether it is safe to close.

Guardrails: never `git push --force`, never rewrite pushed or shared
history, never `git stash` / `checkout` / `restore` / `reset` files you
didn't author: other agents' dirty and staged files are theirs.
`SKIP_SWEEPGUARD=1` only deliberately and rarely. Don't
`AskUserQuestion` on the way out: the banner is the answer.

## Last step — the sign-off banner (MANDATORY, ALWAYS)

The **final thing in your final message**, after the report, is **one** of the two banners below — printed
**verbatim, inside a fenced code block**, as the last lines you emit. Nothing follows it: no sign-off prose,
no "let me know if…", no further tool calls.

**A banner ALWAYS prints. There is no path through this skill that ends without one.** Its job is to answer
*"did this session run prepare-to-exit?"* from across the room — the human reads the answer off the
**silhouette alone**. A silent failure looks exactly like a session that never ran the skill, which is the one
outcome that breaks the signal: a failed checkpoint doesn't *suppress* the banner, it **switches** it.

The two banners answer **one** question — not "did the git commands succeed" but:

> **Is it safe to KILL this pane right now?**

- **BYE — safe to close.** Your work is committed on `main` and pushed with the hooks green, the processes you
  started are closed, your scratch is emptied, the session is at a coherent stopping point, **and the
  leftover-work sweep is done — every finding and deferral this session produced is built or is an open row of
  a live plan**. A BYE is a claim that nothing here will be lost.
- **OOPS — do NOT close.** Any of these, and they weigh the same:
  1. **Something is wrong.** A gate is red on HEAD, a push is refused, a stranded commit with no queued reason —
     or you simply **don't know** whether it's sound. Uncertainty is an OOPS: the banner is a safety signal, so
     it fails *loud*, not *optimistic*.
  2. **Leftover work has no queue.** Something this session ruled, found or deferred lives only in a commit
     body, a journal line, a subagent report, a memory note or a chat message. Build it, or make it a plan row,
     and *then* BYE; if you cannot, OOPS and name it.
  3. **The session is half-built.** Run too early — mid-implementation, an agent mid-round with uncommitted
     edits that nobody else will finish, a feature wired but unreachable, a server still running. **A clean
     `git status` does NOT mean done.** Ask it straight: *if this pane were killed right now, would anything be
     left half-implemented?* If yes → **OOPS**, and the report names exactly what's half-done and where to
     resume.

Never print BYE over either case — a BYE on a half-finished session is a false green, and it is the *report*,
not the banner, that carries the detail.

Both are **fixed, byte-stable signals**, not decoration — they only work if they are **always the same**. Copy
them character-for-character: don't retype from memory, don't restyle, don't personalize, don't append a run
summary inside the box, don't swap the block letters. The two are deliberately distinguishable when blurred or
squished: BYE is light-bordered and 4 glyphs, OOPS is heavy double-bordered and squarer.

**BYE — checkpoint clean:**

```
   ┌──────────────────────────────────────────────────────────────┐
   │  ██████╗ ██╗   ██╗███████╗██╗                                │
   │  ██╔══██╗╚██╗ ██╔╝██╔════╝██║  prepare-to-exit is complete.  │
   │  ██████╔╝ ╚████╔╝ █████╗  ██║  committed - verified - pushed │
   │  ██╔══██╗  ╚██╔╝  ██╔══╝  ╚═╝                                │
   │  ██████╔╝   ██║   ███████╗██╗  you may close this session.   │
   │  ╚═════╝    ╚═╝   ╚══════╝╚═╝                                │
   └──────────────────────────────────────────────────────────────┘
```

**OOPS — prepare-to-exit ran, but this session is NOT safe to close:**

```
   ╔═════════════════════════════════════════════════════════════════════╗
   ║   ██████╗  ██████╗ ██████╗ ███████╗                                 ║
   ║  ██╔═══██╗██╔═══██╗██╔══██╗██╔════╝  prepare-to-exit ran, but       ║
   ║  ██║   ██║██║   ██║██████╔╝███████╗  this session is NOT done.      ║
   ║  ██║   ██║██║   ██║██╔═══╝ ╚════██║                                 ║
   ║  ╚██████╔╝╚██████╔╝██║     ███████║  something is red or half-done  ║
   ║   ╚═════╝  ╚═════╝ ╚═╝     ╚══════╝  read the report; DON'T close.  ║
   ╚═════════════════════════════════════════════════════════════════════╝
```
