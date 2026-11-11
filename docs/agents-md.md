# AGENTS.md: Jake's section and the agent section

> Written by: Claude

Status: active 2026-11-10; the check is `.githooks/agents-md.mjs`.

## Why

Jake, 2026-11-10 (J241): "There should be a human section at the top
and an agent section at the bottom. And then when I have time to garden
and clean up, I'm going to rewrite the human section and start purging
stuff out of the agent section… And then in RepoKit… add some rules
and some linting and some checks around agentsMD." The agents had
rewritten whole files; the marker keeps Jake's words his own.

## The shape

```
# AGENTS.md

<Jake's section>

<!-- agents-below: everything under this line is agent-written (Claude, Codex); agents never edit above it (J241) -->

## Agent-written

> Written by: Claude and Codex (agents). …

<agent content>
```

## What the check enforces

The lint, on every commit (staged files), every push (each pushed
tip), in `pnpm test:hooks` on CI (this repo's own files) and through
`node .githooks/agents-md.mjs lint`:

- `AGENTS.md` exists and holds the marker line exactly once, verbatim;
- the first line after the marker is `## Agent-written`;
- nothing above the marker says `Written by: Claude` or `Codex`, in
  any Markdown form (quote, list item, bold, italic);
- `CLAUDE.md`, if present, is exactly `@AGENTS.md`.

A commit or push that deletes `AGENTS.md` is refused, a new branch or
tag included. A repo whose history never had one (a fresh bootstrap)
can still commit and push; the lint on CI reports it.

The guard, in `commit-msg` and again for every outgoing commit in
`pre-push`, merges included (so `--no-verify` is caught too): a commit
whose message carries an `Assisted-by:` trailer is an AI commit, and
it may not change, add or remove any line above the marker, even its
line endings. It may not remove the marker or delete the file. A
merge, at commit time (HEAD plus `MERGE_HEAD`) and at push, must keep
the section above the marker exactly as one of its marked parents had
it. `commit-msg` cannot see the commit an amend replaces, so it judges
an amend against HEAD; `pre-push` judges every outgoing commit against
its real parents, so relabelling Jake's commit as an AI one is refused
there. The refusal says: put it below the marker; Jake promotes it.

The one exception is the first conversion. When the file had no
marker before, an AI commit may add the marker with a stub above it:
the exact `# AGENTS.md` title and at most three lines of at most 200
characters, with no headings, lists, tables, code or agent
attribution. A file from before J241 that still has no marker is left
to the lint.

## Jake's edit path

A commit with no AI trailer may change anything. Jake edits his
section, or promotes text from the agent section, in a human commit:

```
SKIP_ATTRIB=1 git commit -m "docs(agents): <what changed>" -- AGENTS.md
```

`SKIP_ATTRIB=1` only lifts the commit-message rule that AI commits
carry `Assisted-by:`; every other hook still runs. Agents never take
this path: an agent's change goes below the marker, and Jake moves it
up if he wants it.

## Where it runs

The check is plain Node in `.githooks/`, so a repo gets it with the
kit's hook files: `agents-md.mjs`, `agents-md.test.mjs` and the two
lines in `commit-msg` and `pre-push`. Roll it out only to a repo whose
`AGENTS.md` is already converted, or its next commit is refused.
