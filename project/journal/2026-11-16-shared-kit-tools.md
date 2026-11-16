# Share the kit binary install

> Written by: Codex
> State: built locally, exact hosted proof pending, 2026-11-16.

## Why

REPO-KIT K1b rollout takes the kit-owned native binary profile.
Matching consumers share one frozen compiler, formatter and lint
helper install instead of linking a separate copy in each project.

## Changes

- Pin the small npm-bin-deps runner at kit version 2.1.0.
- Keep the exact compiler, formatter and native helper pins.
- Commit the identical binary package and npm lock profile.
- Keep product pnpm policies and dependency pins in this repo.
- Retain the separate TypeScript 6 compiler API dependency.
- Keep the author lint rules and source lint boundaries.
- Resolve the typed native helper through npr's public interface.
- Resolve the worktree guard formatter through the same interface.
- Install frozen tools before normal hook checks.
- Cache by OS, architecture and the committed profile on CI.
- Refuse manifest or generated-lock drift from kit fingerprints.

## Proof

Normal local checks and the real tool invocations are retained.
The pathspec commit and exact hosted CI result are in the lane log.
No shard content, release or publication changes in this row.
The product's source configs remain owned by this repository.
