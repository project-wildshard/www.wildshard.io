---
name: codebase-design
description: Design vocabulary for deep modules, mapped to our sides and seams. Use when deciding a module's interface or where a seam goes, or when another skill needs the vocabulary. A reference, with no process of its own.
---

# Codebase design

Adapted from Matt Pocock's `codebase-design`
(github.com/mattpocock/skills at `4ae2317`, MIT, see LICENSE here) on
2026-11-05.

`lint/`, `docs/process/`, `docs/ENGINE.md`, `docs/HOST-BAR.md`,
`docs/SUBAGENT-BRIEF.md` and `docs/design/mmo/` paths are
singleplayer's (`~/projects/games/wildshard-singleplayer`); "meta" is
`~/projects/games/project-wildshard-meta`.

This is a **reference**. It starts no survey and redesigns nothing: to
find what to change, Jake runs `improve-codebase-architecture`.

The aim is **deep modules**: a lot of behaviour behind a small
interface, at a clean seam, testable there, and cheap on the phone.

## Words

Use these exactly, in place of "component", "service", "API" or
"boundary". *Side*, *layer*, *host*, *room* and *port* keep their repo
meanings.

- **Module**: anything with an interface and an implementation, at any
  scale: `stepPlayerMotion`, `NetRoom`, a package.
- **Interface**: everything a caller must know: types, invariants,
  ordering, error modes, config and cost per frame. `Transport`'s
  includes "Ownership of `bytes` passes to the transport".
- **Implementation**: the code inside.
- **Depth**: behaviour a caller or test can exercise per unit of
  interface learned. Lines of code don't measure it.
- **Seam**: where you can alter behaviour without editing in that
  place; the location of an interface.
- **Adapter**: a concrete thing that fills a seam. A role, not a kind
  of code.
- **Leverage**: what callers get: one implementation pays back across
  N callers and M tests.
- **Locality**: what maintainers get: change, bugs and verification
  sit in one place.

## Principles

- **Depth is a property of the interface.** A deep module can be built
  from small parts; callers just don't see them.
- **The deletion test.** Delete it in your head. If complexity
  vanishes, it was a pass-through. If it reappears across N callers,
  it earned its keep.
- **The interface is the test surface.** Tests cross the seam callers
  cross. Wanting to test past it means the module is the wrong shape.
- **One adapter is a hypothetical seam; two make it real.** At a
  platform host the bar is higher: two real users
  (`docs/HOST-BAR.md`).
- **Budgets beat abstractions.** On a hot path the phone wins (below).

## Our seams

Copy their shape before cutting a new one. Paths are singleplayer's
until the engine moves (P3, J124).

| Seam | Depth | Adapters |
|---|---|---|
| `Transport`, `src/engine/shared/net/transport.ts` | Bytes on two channels; the game never knows what carries them | `WorkerLoopback`, `ConditionedTransport`, `WebSocketTransport` at E7 |
| `NetRoom`, `src/engine/server/net/room.ts` | Replication for a room; holds no socket and no save | Fed by `NetWorld` and `NetPlayer` |
| `SimHost`, `src/engine/server/sim.ts` | The headless authority; steps commands, N players | Runs in the worker, in Node tests, per grid cell |
| `stepPlayerMotion`, `src/engine/shared/player/motion.ts` | One motion law; `MotionWorld` is its port | `SimHost` and the predicting client |
| `objectStoreContract`, api-server `src/test/helpers/` | One promise for object storage | The local store and the R2 store |
| The shardfile, repo `shardfile` | The one cross-repo format (J3); packs stay engine-internal (J22) | `engine`'s cook, `api-server`'s validator (J27) |

`NET_SCHEMA_HASH` guards the wire seam: client and server match
exactly (J54), so a wire change is one change on both sides.

## Fit

A design that breaks these is the wrong design. Check each one.

- **Sides.** A module sits on one side of `shared/`, `client/`,
  `server/`, `cook/` (J1, J2, meta `docs/multi-repo/MULTI-REPO-PLAN.md`
  §5). Law both sides need is one `shared/` module with an adapter on
  each side. `shared/`, `server/` and `cook/` have no DOM and no
  renderer. In singleplayer `lint/engine-sides.json` tags every file
  and `lint/engine-side-edges.json` may only fall; `engine` has
  `src/scripts/check-sides.mjs`.
- **Layers.** In singleplayer imports run down `engine → game → sdk →
  commons → shards`, and a shard never imports a shard (`AGENTS.md`).
- **No barrels.** A deep module is never an `index.ts`. Its interface
  is the module that defines the binding, listed in the package's
  `exports`; `wildshard/no-reexport` refuses `export … from`.
- **Installers are called.** A service starts from a function the
  session calls, never by being imported.
- **Authority (M1).** The server decides everything shared. Clients
  send inputs, never positions, and predict only their own character,
  through the same `shared/` step (J41). Entity ids stay stable.
- **Fixed step.** Sim logic reads the 60 Hz tick and seeded RNG, never
  a wall clock; snapshots go at 30 Hz (J40). Traces must replay bit
  for bit.
- **Hot paths.** Budgets are `MMO-REQUIREMENTS.md` B1 and J121: the
  phone's 1.0 GB in world, a page at about 24–30 fps in Low Power
  Mode, a worker at 60 Hz. In per-tick and per-frame code, deepen by
  merging, never by adding call layers. No closures, result objects or
  per-entity allocations: write into a caller's buffer, as
  `NetPlayer.sample(out: Uint32Array, …)` does. Estimate the cost in
  the design, then measure it (J121 readings, not a Mac).
- **Shards are untrusted (R1, R2).** A seam for shards passes the host
  bar: data-only, no shard branch in the engine. Behaviour is
  AssemblyScript behind `docs/SCRIPT-ABI.md`.
- **No first-party shortcuts (J86).** First-party shards take the same
  path third parties take. A seam only ours can use fails.

## Testability

1. **Accept dependencies**: `stepPlayerMotion(s, cmd, w, dt)` takes
   its `MotionWorld`, so the same law runs against the server's world
   and the client's.
2. **Return results off the hot path.** On it, write into a buffer the
   caller owns.
3. **Small surface**: fewer entry points, fewer tests.

## Rejected framings

- Depth as implementation lines over interface lines: it rewards
  padding.
- "Interface" as the TypeScript keyword: too narrow.
- A deep module as a folder convention: the module is its interface,
  whatever the tree looks like. Enforcement is lint.

## Going deeper

- [DEEPENING.md](DEEPENING.md): when a candidate's dependencies decide
  how it is tested.
- [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md): when Jake wants alternative
  interfaces compared.
