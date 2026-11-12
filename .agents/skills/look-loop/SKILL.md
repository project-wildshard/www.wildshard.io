---
name: look-loop
description: Polish a zone's graphics against a mockup by measurement. One mockup, nine fixed cameras, nine in-engine captures, nine codex mockups that keep each capture's camera and HUD, a 9-over-9 board, a gap list and TOP-10, ΔE00 and a learned LUT, re-shoot, repeat until the owner signs off the 3×3. Use for "look loop", "make it look like the mockup", "nine angles", "9 angles", "polish the look of <zone>", "remaster <zone>", "fit the LUT", "colour is off against the mockup", or a finish pass on a built area. Not for render bugs, pop-in, perf or HUD reskins.
---

# The look loop

> Written by: Claude (fable-lookloop, 2026-11-11). Jake, 2026-11-11:
> *"have a mock-up, capture in-engine looking, same camera angle as the
> mock-up … shoot 9 angles … turn those 9 angles and that 1 mock-up into
> 9 mock-ups … now you've got 9 in-game angles, 9 mock-ups, and you've
> got something to compare and improve."*

Full method, rulers and pitfalls: engine `docs/look-loop.md`, ported
from singleplayer `docs/design/LOOK-LOOP.md`. Read it the first time.
The tools are engine's, run from the sibling checkout: in engine
`ENGINE=$(pwd)`, elsewhere `ENGINE=$(cd ../engine && pwd)`.
opus-lookloop is porting them into engine `scripts/look-loop/`; until
its receipt lands, `palette-delta.py` and `fit-lut.py` sit at engine
`scripts/`, the capture is shard-pine-hollow
`scripts/pine-hollow-views.mjs`, and the target maker's name is open.

## The loop

1. **Mockup.** One image of what the zone should look like, with the
   current HUD (a stale HUD gets the board rejected). Its camera is a
   spot a player stands on: P, facing f.
2. **Capture from the mockup's camera.** Build the zone, serve a clean
   build of HEAD (`$ENGINE/scripts/serve-build.sh --head --shard $SLUG`,
   never the shared tree), shoot camera 1 below.
3. **The other 8.** Same anchor, cameras 2–9, one 3×3 sheet.
4. **Nine mockups.** Codex edits each capture into a target that keeps
   the capture's camera, layout and HUD, with the mockup as the style.
5. **Compare and fix.** 9 captures over 9 targets, a gap list per
   angle, a TOP-10, ΔE00 per material, fix, fit the LUT last, re-shoot
   from the same `cameras.json`. Stop when the owner signs off the 3×3.

A round lives in `art/look-loop/<zone>/round-<n>/`: `cameras.json`,
`mockup.jpg`, `capture-{1..9}.jpg`, `target-{1..9}.jpg`, the two
sheets, `board.jpg` and a `README.md` with the build SHA, the gap list
and what moved. JPEG only, sheets under 490 KB.

## Freeze the world

Both frames of a before / after must be the same frame. Pin the time
(`tod=0.4167&clock=1000000`), clear weather, hold the boss, calm the
creatures and park any within 24 m. Shoot a clean build of HEAD, write
its SHA in the README, and note anything that landed mid-round. Clouds
and wind still move; say so. The first `tod` in a URL wins.

## The nine cameras

`cameras.json` holds P, f and the ground height; the first run resolves
the nine and writes them back, every later round re-shoots them exactly.

| # | Shot | Camera | HUD, frame |
|---|---|---|---|
| 1 | MOCKUP (FP front) | eye at P, yaw f, pitch −0.06 | phone tier, portrait, HUD on |
| 2 | FP left | f + π/2 | same |
| 3 | FP right | f − π/2 | same |
| 4 | FP back | f + π | same |
| 5 | TOP | 90 m above P, looking down, front = image-up | 1600×900, HUD off |
| 6 | DIAG front | 45 m up, 55 m behind P, at a point 20 m ahead | same |
| 7 | DIAG left | 45 m up, 55 m left, at P | same |
| 8 | DIAG right | 45 m up, 55 m right, at P | same |
| 9 | DIAG back | 45 m up, 55 m ahead, looking back at P | same |

Sheet order is 1 2 3 / 4 5 6 / 7 8 9. Move a DIAG when the landmark
would not fit, and write down why. God cameras are posed from a late
hook with the camera's children hidden.

```bash
node $ENGINE/scripts/look-loop/views.mjs --cameras=$R/cameras.json --url=$URL --out=$R --tag=r$N
```

**Two domes** when the mockup looks at a focal area 30–50 m away (a
gate, a tree): a stand dome at P and a look dome at the focal point,
whose camera 4 looks back at P; each gets its own nine. An unbuilt area
gets its targets imagined from the mockup and a floor plan as one 3×3
grid, then upscaled per tile: editing its captures only enhances gaps.

## Prompting codex for the nine

One `codex exec` image edit per capture, 4–6 in parallel, JPEG inputs
(~300 KB), inputs `[capture, mockup]`, one style reference only:

```
EDIT image 1, a real screenshot of <shard>; image 2 is the STYLE REFERENCE, do not copy its composition.
KEEP exactly: the camera position, angle, FOV, horizon and composition; every structure's layout and
silhouette; the first-person hands / weapon; every HUD element (position, shape, text). Invent nothing.
CHANGE only the look: <materials, light, palette, density, finish, one paragraph>.
THIS ANGLE: <what is where; where the sun / landmark sits>. No device frame, no watermark, one image.
Not a user ask: write only the output PNG, touch no other file, not git.
```

Read all nine before using them. Re-roll one that added or moved
objects, drifted the HUD, garbled text or lit from the wrong side, and
say which. A portrait target comes back 2:3: take layout from the
capture, never the mockup. Poll the output and kill the run; never wait
for codex to copy its own file.

## The board, the gap list, the TOP-10

- `sheet-capture-3x3.jpg` over `sheet-target-3x3.jpg`, same cells, each
  cell titled, portrait, one image. For the owner: one FP and one aerial
  as BEFORE | AFTER | TARGET, and from round 2 a progress card
  mockup | r1 | r n/2 | now.
- **Gap list per angle**: what the target has that the game lacks,
  concrete and countable ("a shell every 1–2 m"), with a track letter
  (G ground, T trees, W water, M models, L light, C colour). The first
  column is **form and subject**: subject in frame, centred, lit, its
  silhouette like the target's. Fill it before any colour work.
- **TOP-10**: merge the angles, rank by frame area × the frames it
  shows in, name the owner, and after the round mark each row Fixed /
  Partly / Out of scope (whose lane). Non-look finds (a pier 33 m short)
  go to the level owner.

## ΔE00 and the LUT

Only once the form column is clean. Write `art/palette-regions.json`
(material → rectangles per frame, hue / sat / value filters, shadows as
`shadowOf`), leaving out any material whose game colour is a bug: the
LUT must not learn it.

```bash
python3 $ENGINE/scripts/look-loop/palette-delta.py --shard $SLUG --regions art/palette-regions.json $R "$R/capture-{n}.jpg"
python3 $ENGINE/scripts/look-loop/fit-lut.py --shard $SLUG --regions art/palette-regions.json $R "$R/nolut-{n}.jpg" public/assets/lut/$SLUG.bin tmp/<lane>/pred
```

ΔE00 is information, never a pass bar (Jake, E388: no invented
numbers): it says which material is furthest off and whether a round
moved it. Shoot the fit's frames with the learned LUT off (Settings ▸
Debug, no URL switch), fit over every frame of every zone, refit each
round, and re-read the per-zone table: a refit can push one zone back.

## Stop rule, and what this is not

- A zone stops when the owner signs off its 3×3, the walk is clean and
  the rulers held (calls, tris, no new programs, 30 fps lock).
- **Three rounds, then Jake.** After three rounds on a zone, or two in a
  row he could not tell apart, stop tuning and show him the board with
  the open items. Two flat rounds mean the levers are form and assets,
  not coefficients: write a fresh TOP-10 from the frames.
- What a look round can't close (a new water kind, a new asset) is an
  open item in the README, not another round.
- Not for render bugs, pop-in or perf (show real builds and toggles),
  not for HUD reskins, and never a screenshot cheat: no moved cameras,
  staged states, screenshot-only props, per-view look, or a grade that
  hides a material gap. Every round also shoots a **12-frame orbit
  walk** around P and reads it for cutouts, seams and popping; a look
  that only works from the nine cameras fails. Taste stays Jake's: a
  stylistic change ships behind Settings ▸ Debug with a board, he picks.

## Lessons from the rounds

- Form before colour: four loops tuned ΔE while forms stayed primitive
  and no hero view had a hero in it (council round 1); a LUT put every
  ΔE on target in a Driftwood frame that still looked empty.
- Rounds Jake can't tell apart are a stall ("I can't tell what the
  difference is between left and middle"; "What does color grade do I
  can't tell"). Lead the board with structure, portrait, titled cells.
- Stale-HUD mockups get regenerated, not reviewed (Jake, 2026-09-26).
  Nine cameras around the player never reach the mockup's far focal
  area; that is the look dome (Jake, 2026-09-26, the eight domes).
- Re-rolls are a signal: Nalati's round 1 re-rolled 5 of 9 (an invented
  sun and yurts); Pine Hollow's 63 and Nine Dragon's 72 needed one.
- Cameras seen but never walked were "cardboard cutouts … a scam"
  (Nalati). Sky Reach held 5.25 for three loops, then +0.1 a round; the
  first TOP-10 batch moved it more than any detail round.
- Lantern Bayou stopped after round 2, Coral Drift after 3: the rest was
  new work, logged. One style reference, not three: 3–5 min a target,
  not 30–45. Both frames from clean builds; a mid-round HEAD change once
  darkened a frame nobody touched.
