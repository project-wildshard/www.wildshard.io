<!-- Copied from `Raynos/project-wildshard-meta` docs/multi-repo/MULTI-REPO-PLAN.md on 2026-11-05: history, not live. -->

# Multi-repo mega plan

> Written by: Claude

> **State:** draft, 2026-11-04. Rewritten the same evening after Jake chose one engine repo. Decisions J1–J32 are
> Jake's; the rest is proposed until he answers §9. Singleplayer facts are from
> `Raynos/project-wildshard-singleplayer` at `727236c625` (checkout `~/projects/games/wildshard-singleplayer`).
> Repo list: Jake's [`REPOS.md`](../../REPOS.md). Per-repo detail: [`REPOS_DETAILS.md`](../../REPOS_DETAILS.md).

## 1. Goal

Split the singleplayer monorepo into repos under a private `project-wildshard` GitHub org:

- **the shardfile** is the raw, engine-agnostic upload format, with its own repo, spec and validator;
- **the engine** is one repo with shared, client and server code and two build targets, shaped like Unreal or
  Source;
- **each shard** is its own repo and builds a shardfile the way an outside author would;
- **uploads, dev tools and the marketing site** each have their own repo, CI and deploy.

This plan covers *repo layout and migration order*. It is not the one-world / crossings MMO plan, which Jake keeps
for himself (singleplayer `docs/plans/decisions.md` G828, G1011). It does not build rooms, netcode or persistence
(G41; `docs/design/mmo/MMO-REQUIREMENTS.md` T5). The meta repo stays as it is.

## 2. Decisions (Jake, 2026-11-04)

| # | Decision |
|---|---|
| J1 | **One `engine` repo** with `shared/`, `client/` and `server/` folders, lint that keeps client and server completely separate, and build targets that output the client and server as separate things. It replaces the earlier `mmo-server`, `mmo-client` and `protocol` repos |
| J2 | Client never imports server code and server never imports client code; both import `shared/` (as Source's `game/shared` is built into both DLLs) |
| J3 | **The shardfile is the raw format**: a tarball of JSON + assets that authors upload. The engine does not run on it. The build **cooks** it into **runtime packs**, which are GPU- and physics-ready and keyed by shardfile hash + engine build (singleplayer DOWNLOAD, `docs/plans/DOWNLOAD.md:152-158`) |
| J4 | Replication is **declared on entity state**, like Source SendTables or Unreal `Replicated` properties; snapshots and deltas are generated from it |
| J5 | The server owns the sim. The client renders, takes input, predicts its own character and interpolates everything else |
| J6 | `api-server`: shard upload and download for authors, `sharddev` and the server. A thin wrapper around Cloudflare R2 for now. It also gets all the Vercel functions (`api/`) |
| J7 | `shardfile` holds spec + validator. The bake/build CLI goes to `sharddev` |
| J8 | `sharddev` runs the engine's client build against its server build. It also holds the explorers, the arena and the drafts tool |
| J9 | Admin console, native apps and infra go to `leftover` |
| J10 | Art splits by owner: the engine (shared client art, highway and centre) and each shard |
| J11 | Repos depend on each other through git dependencies pinned by tag; there is no registry |
| J12 | New repos start with fresh history. Singleplayer is the archive and will be archived |
| J13 | Large binaries go to R2; sources and small files stay in git |
| J14 | All repos are private |
| J15 | One `shard-templates` repo. Pine Hollow's repo is `shard-pine-hollow` (chosen in the Q&A; `REPOS.md` still says `shard-pinewood`) |
| J16 | Offline play (no server) is decided later. J31's standalone target is the likely answer |
| J17 | Cut inside singleplayer first, move second. The engine split is measured and lint-enforced in-tree before the engine repo exists |
| J18 | Process art and screenshots (about 2 GB) stay in the archived singleplayer repo |
| J19 | The meta repo stays; don't move it |
| J20 | ~~The cook runs in both places~~ Replaced by J27 |
| J21 | The **author SDK** (what shard generators import) lives in **`sharddev`**, which re-exports what it needs from `engine` |
| J22 | The runtime pack format is **engine-internal**, keyed by engine build, and never a cross-repo contract |
| J23 | Git dependencies get built output from **`dist/` committed on tag-only release commits** |
| J24 | ~~`api-server` runs the engine's cook as a pinned binary~~ Replaced by J27 |
| J25 | C1, C2 and C3 (standalone cook, server packs, dynamic catalogue; were P1.5, P1.6, P1.9) wait until **DOWNLOAD closes**; the other P1 rows can start now |
| J26 | The singleplayer plan for the P1 rows is drafted **after** the P1.3 measurement |
| J27 | **`api-server` depends only on `shardfile`.** It validates uploaded shardfiles, stores them in R2, and tells the MMO server (the engine's server target) that a new shardfile exists. **Only the MMO server cooks.** `api-server` never runs or imports engine code |
| J28 | The cook runs in a **separate cook worker** beside the MMO server, built from the same engine build, so the game server never cooks in-process. It cooks both client packs (written to R2) and server packs |
| J29 | After an engine release, the new build **re-cooks every live shard at deploy**, before it takes traffic |
| J30 | `api-server` notifies with a **plain HTTP call**; at boot the server also lists the shardfiles to catch anything it missed |
| J31 | **Listen server.** A third, *standalone* build target runs the server build in a Web Worker and the client talks to it over an in-process loopback, as Source and Unreal do for singleplayer. The game keeps shipping through the migration with `client/` never importing `server/` |
| J32 | **Plans live only in this repo.** No plan or status files go into singleplayer. Lanes doing P1 work there commit code to singleplayer and record status in [STATE.md](STATE.md) here |

## 3. The pipeline

```
 shard repo            sharddev            api-server                 MMO server host (engine server build)
 ──────────            ────────            ──────────                 ─────────────────────────────────────
 author source ─build─► shardfile ─upload─► validates (shardfile pkg)
 (generators,          (raw JSON +          stores it in R2
  Blender, data,        assets tarball)     HTTP ─"new shardfile"────► MMO server ─► cook worker (same build)
  AssemblyScript)                                                      fetches shardfile from R2, cooks per target × tier × entry:
                                                                         client packs: GPU + physics ─► R2
                                                                         server packs: physics + sim ─► MMO server
                                                                                       │
                       engine client build  ◄── downloads client packs from R2 ────────┘
```

| Stage | Owner | Contract? |
|---|---|---|
| Author source → shardfile | `sharddev` (bake CLI), run in each shard repo | The shardfile is the public, versioned contract (`shardfile` repo) |
| Shardfile → runtime packs | `engine` cook code, run **only by the cook worker beside the MMO server** (J27, J28) | **Engine-internal.** Packs are keyed by engine build, so their format changes freely with the engine and never crosses repos |
| Packs → running game | `engine` client and server targets | Wire format generated from declared entity state (J4) |

This is the Unreal split. The shardfile is the raw `.umap`, and packs are the platform cook: a client cook keeps
render data, while a server cook drops it and keeps collision. Both sides read collision from packs cooked by the
same engine code, so prediction and authority agree on the world by construction.

**Today**, world content already loads dynamically from packs. Runtime packs have been on by default since DL16
(`d0683e4e38`). But the cook runs inside the app build (`scripts/app-build/spawnParts.ts`, in `build-app`; DOWNLOAD
DL5) over the shards in the tree. And the client still compiles in every shard's discovery manifest
(`src/shards.generated.ts`, 28 static imports). So the shard *list* is not dynamic yet (P1 row C3).

**In production only the MMO server side cooks** (J27–J30):

- `api-server` validates the shardfile, stores it and calls the MMO server over HTTP.
- The MMO server hands the shardfile to a separate cook worker built from the same engine build.
- The worker writes client packs to R2 and gives server packs to the MMO server.
- On an engine release the new build re-cooks every live shard before it takes traffic.
- At boot the server lists the shardfiles to catch any notification it missed.

## 4. Target repos

```
shardfile         raw spec, validator                         depends on: nothing
engine            shared/ client/ server/ cook/; 2 targets    depends on: shardfile
api-server        validate + store in R2, notify the server;  depends on: shardfile only
                  Vercel APIs
sharddev          bake CLI, dev server, explorers, drafts     depends on: engine, shardfile; runs both targets
shard-*           one shard each                              build: sharddev; uploads to api-server
www.wildshard.io  marketing site                              reads published facts; waitlist → api-server
leftover          admin console, native apps, infra
```

| Repo | Takes from singleplayer |
|---|---|
| `shardfile` | `src/format` (54k LOC, imports only `valibot`), `docs/SHARDFILE.md`, `docs/PLATFORM-FILE-FAMILIES.md`, `docs/SCRIPT-ABI.md`, `scripts/gen-format-schema.mjs`, and `validate` + `schema` from `src/sdk/cli.ts` |
| `engine` | `src/engine` and `src/game` re-cut into `shared/` / `client/` / `server/` (§5); the headless host (`src/sdk/headless.ts` and the tick worker); the cook (`scripts/app-build/spawnParts.ts` and the pack builder); the app shell (`src/*.ts`, `index.html`, `vite.config.ts`); `src/commons`; shared assets (`public/assets/{gpu,tex,music,sfx,hdri,models,baked}`); shared and highway art. Deploys the game on Vercel `wildshard-singleplayer` |
| `api-server` | `api/` (telemetry, errors, inbox, waitlist, crossroads, blob store), plus new upload / list / fetch endpoints over R2 and a "new shardfile" notification to the MMO server |
| `sharddev` | The author SDK (`src/sdk` public surface, J21), `src/sdk/cli.ts` minus validate, `src/sdk/bake/` (including the AssemblyScript → Wasm compiler), `scripts/build-shardfiles.mjs`, `scripts/shardfile-cache.mjs`, `src/engine/explore/`, `drafts/` (`wildshard-drafts`), `scripts/docs/author-project` |
| `www.wildshard.io` | `site/`, `site-deploy.yml`, Vercel `wildshard-site` |
| `leftover` | `admin/`, `ios/`, `android/`, `capacitor.config.ts`, `deploy/ota`, infra notes, the cross-repo workspace script, anything unclaimed |
| `shard-*` | `src/shards/<slug>` plus its `public/assets/<slug>`, `scripts/blender/<slug>`, `art/<slug>*` and tests. Repos: driftwood, pine-hollow, nalati, nine-dragon, dunes (`sunscar-dunes`), sky-reach (`far-reach`), open-plots, templates (`_template`, `blender-template`, `ink-cel-valley`, `pastel-plain`) |

## 5. The engine's folders

Source keeps `game/shared/` (movement in `gamemovement.cpp`, weapons in `weapon_csbase.cpp`, game rules) and builds
it into both `client.dll` and `server.dll`. Unreal builds one project into a client target and a `TargetType.Server`
target, and `UCharacterMovementComponent` runs on both. The engine repo follows that shape.

| Folder | Holds (sizes are estimates) | May import |
|---|---|---|
| `shared/` | Fixed-step tick core and seeded RNG; pack loading for collision and sim data; player movement and physics (measured: about 4.5k clean LOC in `engine/player` + `engine/physics`, plus the motor half of `Player.ts`; Rapier pinned); entity state with replication and prediction declarations (J4); input commands (today `src/sdk/tickProtocol.ts`); snapshot encoding (today `src/engine/sim/snapshot*.ts`); whatever combat is predicted | `shared/`, `@wildshard/format`, `three` maths only; no DOM, no renderer |
| `server/` | Authority: AI, creatures, population, bosses, combat resolution, quests, loot, ledger, weather, Wasm shard scripts, grid, saves (measured: 33k on today's server path, 36k clean but browser-only, ≤ 49k mixed with rendering; see [ENGINE-CUT.md](ENGINE-CUT.md)); later rooms and persistence | `shared/`, `server/`; no DOM, no renderer |
| `client/` | Rendering, UI, audio, models, looks, effects, animation, input, interpolation, prediction glue, app shell | `shared/`, `client/` |
| `cook/` | Shardfile → runtime packs, for each target | `shared/`, `@wildshard/format`, encoders; never `client/` runtime |

**Lint.** These are hard errors once the cut is done, not ratchets:

- `client ↛ server`, `server ↛ client`, `shared ↛ client|server`.
- `shared` and `server` have no DOM and no renderer. This extends today's `wildshard/sim-no-render`, which covers
  only `src/engine/{ai,combat,events,quest,saves}` (`docs/ENGINE.md:270`).
- Each target's build fails if it pulls in the other side.

**Measured (P1.3, [ENGINE-CUT.md](ENGINE-CUT.md)).** Today's headless host is nearly clean: 8 files and 10 imports
stand between it and a build with no renderer or DOM. But it covers a slice of the game. Of about 120k LOC of gameplay
folders:

- 33k is already on the server path;
- 36k is clean logic that only the browser runs (bosses' law, riding, quests, loot, weapons decisions), which needs
  wiring into the server tick;
- 49k sits in files that also draw. Sorted (pass 2): about 14–19k is real sim/view mix to split, about 17k is client
  loading and session code to rewrite around the server connection, and about 11–15k is pure view.

The other ~107k LOC is presentation, boot or tooling.

**Offline play and shipping during the migration.** Once the server owns the sim, the client alone cannot play. The
standalone target (J31) runs the server build in a Web Worker beside the client: a listen server, as in Source and
Unreal. Production ships standalone until MMO servers exist. See P1 row E5.

## 6. Version model

- **The only cross-repo contract that changes often is the shardfile.** Packs are internal to the engine (§3), and
  the engine is one repo, so an engine change is one commit in one repo, as it is today. A shardfile change ripples:
  1. tag `shardfile`;
  2. bump `engine`, `api-server` (validator only) and `sharddev`;
  3. shard repos rebuild their shardfiles as needed.
- **Mitigating format churn.** `src/format` changed 2,403 times in 30 days. To keep that manageable:
  - batch format changes into tagged releases;
  - keep the legacy reader so older shardfiles still cook;
  - use a script that opens the bump PRs.
- **Git dependencies (J11).**
  - Pin a tag, never a branch (`github:project-wildshard/shardfile#v0.1.3`).
  - Releases commit built `dist/` on a tag-only commit (J23).
  - CI installs with an org token, because all repos are private (J14).
- **Re-cooking.** An engine release makes every pack stale, because packs are keyed by engine build. Since only the
  MMO server side cooks (J27), the newly deployed build's cook worker re-cooks every live shard from the shardfiles
  in R2 at deploy, before the build takes traffic (J29).

## 7. Phases

Rule (J17): **cut inside singleplayer first, move second.** The detailed plans, all in this repo (J32):

| Phase | Plan | What |
|---|---|---|
| P0 | [P0-SETUP.md](P0-SETUP.md) | Org, CI token, R2 buckets, bootstrap and release scripts, Vercel mapping |
| P1 | [P1-IN-TREE.md](P1-IN-TREE.md) | In-tree cuts in singleplayer, by track: F format/CLI, E engine cut (incl. E5 listen server), S shards, W site, T tooling, C cook + catalogue (after DOWNLOAD, J25) |
| P2–P6 | [MOVES.md](MOVES.md) | The standard move, then: shardfile, www, api-server → engine + leftover → sharddev → shards → close out |

Live status: [STATE.md](STATE.md). Measurements: [ENGINE-CUT.md](ENGINE-CUT.md).

## 8. Risks

- **The engine cut is the long pole.** It is measured now (ENGINE-CUT.md): 10 imports to cut, 36k LOC to wire into
  the server tick, 17k of client loading to rewrite around the server, and 14–19k LOC to split. All of P3 waits on
  E2–E6 and C1–C2.
- **Deploy time grows with the catalogue.** Re-cooking every live shard at deploy (J29) scales with shard count.
  Measure the cook per shard early (C1) so a 25-shard grid doesn't turn into an hour-long deploy.
- **Moving targets.** C1, C2 and C3 touch DOWNLOAD's pack pipeline, so they wait for DOWNLOAD to close (J25).
- **Red CI.** `deploy.yml` runs 26–44 min with many red or cancelled runs, and the last 8 runs of
  `admin-deploy.yml` failed. Get CI green first.
- **Untrusted cooks.** The cook worker cooks uploaded (untrusted) shardfiles. It runs apart from the game server
  (J28); give it time and memory limits too. `api-server` validation is the first
  gate. SHARDFILE-NEXT N7 (harden the loader before any non-first-party load) applies to the cook too.
- **Repo weight.** New repos stay small only if CI enforces J13's size cap (singleplayer
  `docs/process/STORAGE.md`).

## 9. Open decisions (Jake)

None at the moment. Next: draft the singleplayer plan for the P1 rows (J26).
