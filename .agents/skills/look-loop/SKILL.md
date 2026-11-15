---
name: look-loop
description: Shoot a zone or a cleanroom scene from fixed cameras beside its targets, one board, and fix what the board shows with geometry, materials and light. Fixed cameras, a capture-over-target board, a form-first gap list, a TOP-10, an orbit walk, re-shoot. Use for "look loop", "make it look like the mockup", "nine angles", "9 angles", "match the golden targets", "board against the targets", "remaster <zone>", or a finish pass on a built area. Not for render bugs, pop-in, perf or HUD reskins.
---

# The look loop

> Written by: Claude (fable-lookloop, 2026-11-11; cut to cameras
> and boards by opus-lookaudit, 2026-11-13). Jake, 2026-11-11:
> *"have a mock-up, capture in-engine looking, same camera angle as
> the mock-up … shoot 9 angles … now you've got 9 in-game angles, 9
> mock-ups, and you've got something to compare and improve."*
> Jake, 2026-11-13: *"All the LUT fucking around sure feels like a
> waste of time to me"*; the colour-matching steps are gone.

Rounds run when Jake names one or a plan row asks for a board (J281).
Full method and pitfalls: engine `docs/look-loop.md`. The tools are
engine's `scripts/look-loop/` (`views.mjs`, `targets.py`), run from
the sibling checkout: in engine `ENGINE=$(pwd)`, elsewhere
`ENGINE=$(cd ../engine && pwd)`. Each takes `--help`.

## The loop

1. **Targets.** The bar is a fixed set of target images, each with
   its camera: a template's 20 golden targets, or one approved
   mockup. Its camera is a spot a player stands on: P, facing f.
2. **Cameras.** One `cameras.json` per area, resolved once and
   re-shot exactly every round (below).
3. **Capture** each target's camera from a clean build of a named
   SHA. In engine: `$ENGINE/scripts/serve-build.sh --head --shard
   $SLUG`, then `views.mjs`. In a cleanroom scene: the scene's own
   capture script poses the same cameras (see Cleanroom).
4. **Board.** Target over capture, same cells, same camera, titled.
5. **Gap list and TOP-10**, form first. Fix the top rows with
   geometry, materials, light, sky and fog. Re-shoot from the same
   `cameras.json`. Stop when the owner signs off the board.

A round lives in `$R`, `art/look-loop/<zone>/round-<n>/`:
`cameras.json`, the target per camera, per anchor the captures
`<anchor>/r<n>-capture-<k>-<id>.jpg`, the sheets, `board.jpg` and a
`README.md` with the build SHA, the frame rate, the gap list and what
moved. JPEG only, sheets under 490 KB.

## Freeze the world

Both frames of a before / after must be the same frame. Pin time and
weather in `cameras.json` `settings`, Debug picks written before the
load (`{"time": "midday", "weather": "clear"}`), never a URL switch.
views.mjs calms the creatures and parks any within 24 m. Write the
build's SHA in the README and note anything that landed mid-round.
Clouds and wind still move; say so.

## The nine cameras

`cameras.json` holds `query` (`chunk=<slug>&mute=1&skipintro=1&nolock=1&sw=0`),
`settings`, `fp`, `god` (`topUp`, `diagUp`, `diagOut`, `lookAhead`;
shorter for a small level) and `anchors` (`id`, `P`, `faceTo`). The
first run resolves the nine and writes them back; every later round
re-shoots them exactly. Example: engine `docs/look-loop.md`.

| # | Shot | Camera | HUD, frame |
|---|---|---|---|
| 1 | FP front (the target's) | eye at P, yaw f, pitch −0.06 | phone tier, portrait, HUD on |
| 2 | FP left | f + π/2 | same |
| 3 | FP right | f − π/2 | same |
| 4 | FP back | f + π | same |
| 5 | TOP | 90 m above P, looking down, front = image-up | 1600×900, HUD off |
| 6 | DIAG front | 45 m up, 55 m behind P, at a point 20 m ahead | same |
| 7 | DIAG left | 45 m up, 55 m left, at P | same |
| 8 | DIAG right | 45 m up, 55 m right, at P | same |
| 9 | DIAG back | 45 m up, 55 m ahead, looking back at P | same |

Sheet order is 1 2 3 / 4 5 6 / 7 8 9. When the targets are a fixed
golden set, shoot exactly the targets' cameras instead (one per
target, named after it, `t1-09-pond-bridge-fp-crossing`). Move a DIAG
when the landmark would not fit, and write down why.

```bash
$ENGINE/scripts/browser-lane.sh --max 20 node $ENGINE/scripts/look-loop/views.mjs \
  --cameras=$R/cameras.json --url=$URL --out=$R --tag=r$N [--anchor=<id>]
```

**Two domes** when the target looks at a focal area 30–50 m away (a
gate, a tree): a stand dome at P and a look dome at the focal point,
whose camera 4 looks back at P; each gets its own nine.

## Cleanroom scenes

A standalone three.js + rapier scene (TEMPLATES-CLEANROOM-PLAN) takes
the same `cameras.json`: P, yaw, pitch and FOV per camera, from the
shard's layout numbers. Its capture script loads the scene headless
(`--use-angle=metal --mute-audio --use-mock-keychain
--password-store=basic`), waits for a settled frame, poses each
camera, and writes `capture-<k>-<id>.jpg` and the frame rate. The
board is the same: target over capture, camera by camera. The port
back re-shoots the same cameras in engine, so the cleanroom board and
the in-engine board line up cell for cell.

## Targets for cameras with none

When a camera has no target (the other 8 around a single mockup),
`targets.py` makes one: a `codex exec` image edit of the capture with
the mockup as the style, 5 in parallel, writing `mockup-<k>-<id>.jpg`
and `mockup-sheet.jpg`. Re-roll one by deleting it and passing
`--only=<k>`; `--dry-run` prints the prompts.

```bash
python3 $ENGINE/scripts/look-loop/targets.py --captures $R/<anchor> --out $R/<anchor> \
  --seed-mockup $R/mockup.jpg --tag r$N --game "<shard>" --keep "<landmarks>"
```

Read all of them before use. Re-roll one that added or moved
objects, drifted the HUD, garbled text or lit from the wrong side,
and say which. An unbuilt area gets its targets from the mockup and a
floor plan as one 3×3 grid, then upscaled per tile: editing captures
of an empty scene only enhances the gaps.

## The board, the gap list, the TOP-10

- **The board:** each cell titled, target over capture, one image,
  the frame rate on it. From round 2, a progress card target | r1 |
  now. Open it for Jake as an artifact with a JAKE-READ-LIST line.
- **Gap list per camera**: what the target has that the frame lacks,
  concrete and countable ("a shell every 1–2 m"), with a track letter
  (G ground, T trees, W water, M models, L light, S sky and fog,
  P materials). The first column is **form and subject**: subject in
  frame, centred, lit, its silhouette like the target's.
- **TOP-10**: merge the cameras, rank by frame area × the frames it
  shows in, name the owner, and after the round mark each row Fixed /
  Partly / Out of scope (whose lane). Non-look finds (a pier 33 m
  short) go to the level owner.
- **Colour is a light and material fix.** A sky, a sun, a fog, a
  material's albedo and roughness, a lamp: change the thing that
  makes the colour, and judge it by eye on the board.

## Stop rule, and what this is not

- A zone stops when the owner signs off its board, the orbit walk is
  clean and the rulers held (calls, tris, no new programs, the frame
  rate on the board, 30 fps phone lock).
- **Three rounds, then Jake.** After three rounds on a zone, or two
  in a row he could not tell apart, stop and show him the board with
  the open items. Two flat rounds mean the levers are form and
  assets: write a fresh TOP-10 from the frames.
- What a round can't close (a new water kind, a new asset) is an open
  item in the README, not another round.
- Every round also shoots a **12-frame orbit walk** around P and
  reads it for cutouts, seams and popping; a look that only works
  from the fixed cameras fails. Every fix holds for a player who
  walks: no moved cameras, staged states, screenshot-only props,
  per-view looks or a screen-space grade fitted to the targets. Taste
  stays Jake's: a stylistic change ships behind Settings ▸ Debug with
  a board, he picks.

## Lessons from the rounds

- Form before colour. Four loops tuned colour while forms stayed
  primitive; a fitted LUT put every colour number on target in a
  Driftwood frame that still looked empty. Mossgate's 2026-11-12 LUT
  cut its sky's error 26 → 6 and Jake still called the shard
  *"mostly graphical trash"* that night (J312). The gaps were stone,
  lamp light, trees, water and the boss.
- Rounds Jake can't tell apart are a stall ("What does color grade
  do I can't tell"). Lead the board with structure, portrait, titled
  cells.
- Stale-HUD targets get regenerated, not reviewed (Jake, 2026-09-26).
  Nine cameras around the player never reach a far focal area; that
  is the look dome.
- Cameras seen but never walked were "cardboard cutouts … a scam"
  (Nalati). The first TOP-10 batch moved Sky Reach more than any
  detail round.
- One style reference, not three: 3–5 min a target, not 30–45. Both
  frames from clean builds; a mid-round HEAD change once darkened a
  frame nobody touched.
