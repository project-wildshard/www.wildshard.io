# Deepening

How to deepen a cluster of shallow modules, given what it depends on.
Vocabulary and fit rules: [SKILL.md](SKILL.md).

## Dependency categories

The category decides how the deepened module is tested at its seam.

1. **In-process**: pure computation, no I/O. Merge the modules and
   test through the new interface. No adapter. Our law, like
   `stepPlayerMotion`, wants to end up here.
2. **Local-substitutable**: a real stand-in runs in the suite. Rapier
   and `SimHost` run headless in Node; the worker loopback carries
   real bytes. The seam stays internal.
3. **Remote but owned**: our own process across a network or a
   worker. Define a port at the seam, with a production adapter and
   an in-memory one. `Transport` is the model: `WorkerLoopback` today,
   `WebSocketTransport` at E7, `ConditionedTransport` for latency and
   loss in tests.
4. **True external**: R2, Neon, Vercel, a model API. Inject a port and
   hold every adapter to one contract, as api-server's
   `objectStoreContract` does for its local store and its R2 store.

## Seam discipline

- Two adapters, production plus test, justify a port. One adapter is
  indirection, and on a hot path it is also a cost.
- Internal seams stay private to the implementation, even when its
  own tests use them.
- A seam that crosses a side carries bytes or plain data, so each side
  builds without the other.

## Tests: replace, don't layer

- Write tests at the deepened interface. Assert outcomes through it,
  never internal state.
- Once those exist, delete the tests on the shallow modules they
  replace.
- **Records are the exception.** Frozen oracles, goldens and trace
  fixtures are history: keep their bytes (`41fe96961e`), and let them
  prove the new module matches the old, as the 40,000-tick traces did
  for E4.1.
- A deepening that moves files keeps the side checks green (engine's
  `src/scripts/check-sides.mjs`), and any count it touches may only
  fall.
