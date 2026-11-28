#!/usr/bin/env python3
"""A draft chart of Wildshard 1.0, map v3 (art round 4): plots on a flat world adrift in the void (E505).

Jake on round 2/3: the land must not run across shard seams. Every shard is built alone by its own author on its own
500 m plot and slotted into the grid by the server, so nothing crosses a seam except the Boulevard. Each plot's
design stops at its own edge; the 62.5 m gap is server ground, a verge that fades the shard's edge down to the road,
and where an author left a high edge it shows as a cut-off cliff (hachures), where they left water, a sea wall.
The grid owns only an on- and off-ramp at each edge's middle; past the ramps each shard builds what it likes.
Wildshard is a flat world floating in space: the hundred uploads sit in a ragged fringe of placeholder plots, the
Boulevard breaks off where content stops, and past the rim is the void.

Style: the Isle of Vaelmora map Jake approved (x.com/xikhar/status/2114455448946700694). Every shard is invented.

    python3 -I art/world-map/worldmap.py tmp/world-map/full.png 2
    python3 -I art/world-map/cut-tiles.py tmp/world-map/full.png src/site/public/map/tiles

The optional scale redraws the same chart larger (2 gives 8800 x 10600): every coordinate, width and font is in
design units of the 4400 x 5300 sheet, and SDraw multiplies them onto a canvas that many times bigger.
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else 'tmp/world-map/full.png'
SCALE = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
SEED = 2025
C, G = 320, 40                 # a 500 m cell and its 62.5 m gap, full-res pixels
P = C + G
N = 10
W, H = 4400, 5300
WS, HS = int(W * SCALE), int(H * SCALE)
GX0 = (W - (N * C + (N - 1) * G)) // 2
GY0 = 780
HEART = (GX0 + 5 * P - G / 2, GY0 + 5 * P - G / 2)
FS = 2                          # fields are computed at half resolution
FX0, FY0 = GX0 - P, GY0 - P     # the field covers the hundred plus one unclaimed ring
FN = 12 * P // FS               # 2160
CH = C // FS                    # a cell in field pixels (160)
WM = 128                        # window margin in field pixels (0.8 cell)
WN = CH + 2 * WM                # window size (352)
INK = (58, 44, 34)
ROAD_H = 0.2                    # the Boulevard's grade; the server verge fades every shard edge to it
VERGE = (200, 196, 166)
PAPER = (238, 228, 202)
FONTS = '/System/Library/Fonts/Supplemental/'


def font(name, size, index=0):
    return ImageFont.truetype(FONTS + name, max(1, round(size * SCALE)), index=index)


class SDraw:
    """ImageDraw in design units on a canvas SCALE times larger: coordinates, widths and text all scale."""

    def __init__(self, im):
        self.d = ImageDraw.Draw(im, 'RGBA')

    @staticmethod
    def _xy(xy):
        xy = list(xy)
        if xy and isinstance(xy[0], (tuple, list)):
            return [(x * SCALE, y * SCALE) for x, y in xy]
        return [v * SCALE for v in xy]

    @staticmethod
    def _kw(kw):
        for k in ('width', 'stroke_width'):
            if k in kw and kw[k]:
                kw[k] = max(1, int(round(kw[k] * SCALE)))
        return kw

    def line(self, xy, **kw):
        self.d.line(self._xy(xy), **self._kw(kw))

    def ellipse(self, xy, **kw):
        self.d.ellipse(self._xy(xy), **self._kw(kw))

    def rectangle(self, xy, **kw):
        self.d.rectangle(self._xy(xy), **self._kw(kw))

    def polygon(self, xy, **kw):
        self.d.polygon(self._xy(xy), **self._kw(kw))

    def pieslice(self, xy, start, end, **kw):
        self.d.pieslice(self._xy(xy), start, end, **self._kw(kw))

    def arc(self, xy, start, end, **kw):
        self.d.arc(self._xy(xy), start, end, **self._kw(kw))

    def text(self, xy, text, **kw):
        self.d.text((xy[0] * SCALE, xy[1] * SCALE), text, **self._kw(kw))

    def textlength(self, text, font):
        return self.d.textlength(text, font=font) / SCALE


# ---------------------------------------------------------------- raster helpers

def up(a, w, h):
    return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((w, h), Image.BICUBIC))


def fbm(rng, n, base=3, octaves=5, pers=0.5):
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        r = max(1, int(base * 2 ** o))
        g = rng.random((r + 3, r + 3)).astype(np.float32)
        k = max(1, n // r)
        big = up(g, n + 2 * k, n + 2 * k)
        out += amp * big[k:k + n, k:k + n]
        tot += amp
        amp *= pers
    out /= tot
    lo, hi = np.percentile(out, 1), np.percentile(out, 99)
    return np.clip((out - lo) / (hi - lo + 1e-6), 0, 1)


def ridged(rng, n, base=3, octaves=5):
    return 1 - np.abs(2 * fbm(rng, n, base, octaves) - 1)


def _box(a, r, ax):
    pad = [(r + 1, r) if i == ax else (0, 0) for i in range(2)]
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=ax, dtype=np.float64)
    if ax == 0:
        return ((c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)).astype(np.float32)
    return ((c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)).astype(np.float32)


def blur(a, r):
    r = int(r)
    if r < 1:
        return a
    for _ in range(3):
        a = _box(_box(a, r, 0), r, 1)
    return a


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def ramp(h, stops):
    ts = np.array([s[0] for s in stops], np.float32)
    cs = np.array([s[1] for s in stops], np.float32)
    out = np.empty(np.shape(h) + (3,), np.float32)
    for k in range(3):
        out[..., k] = np.interp(h, ts, cs[:, k])
    return out


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return np.asarray(a, np.float32) * (1 - t) + np.asarray(b, np.float32) * t


def contour(f, level, width=0.9):
    gy, gx = np.gradient(f)
    g = np.sqrt(gx * gx + gy * gy) + 1e-6
    return np.clip(1 - np.abs(f - level) / (g * width), 0, 1)


def shade_col(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c[:3])


def sample(field, x, y):
    """A field value at full-res canvas coordinates (nearest)."""
    fx = int((x - FX0) / FS)
    fy = int((y - FY0) / FS)
    if 0 <= fx < FN and 0 <= fy < FN:
        return field[fy, fx]
    return None


# ---------------------------------------------------------------- the hundred shards (all invented)

# The hundred, in rank order (most played first). Five kinds, twenty each (Jake, 2026-10-26): pop-culture homages,
# tiny copies of real games, original MMO zones, memes, and half-built / abandoned / template / founders' plots.
# (name, biome, landmark icon, the pitch, kind)
SHARDS = [
    # the Heart
    ('Serpent Way', 'kai', '', 'A 400 m snake road over the clouds to a planet the size of a house', 'pop'),
    ('The White Tiers', 'tiered', '', 'Seven white walls up one hill; hold the gate against the night', 'pop'),
    ('Rebuild Town', 'city', 'tower', 'A drop-in town levelled every match and rebuilt by dawn', 'game'),
    ('Dragonspire', 'volcano', 'citadel', 'Forty players, one volcano, the Ember Wyrm in its crater', 'zone'),
    # the Inner Ring
    ('Spicefall', 'dune', '', 'Ride the sandworm across the deep desert before it eats you', 'pop'),
    ('Camphor Hollow', 'forest', 'greattree', 'A camphor tree like a tower and a bus stop where something big comes', 'pop'),
    ('The Underside', 'farmland', 'portal', 'A sleepy town with its dark mirror one portal below', 'pop'),
    ('Little Capital', 'wowcity', '', 'The whole capital, canals and cathedral, at 1:20 for the nostalgia', 'game'),
    ('Prism Run', 'rainbow', '', 'No rails, no mercy: a hoverboard race over the void', 'game'),
    ('Pocket Kingdom', 'meadow', 'castle', 'One field, one castle, one volcano: the whole adventure in 500 m', 'game'),
    ('Skyharbor', 'sky', 'airship', 'Airship races between floating docks; fall and you fall forever', 'zone'),
    ('The Drowned Colossus', 'reef', 'colossus', 'Dive the lagoon to wake the titan sleeping under it', 'zone'),
    ('Neon Lotus', 'neon', 'pagoda', 'A night market of duels, noodles and rooftop chases', 'zone'),
    ('The Hollow Crown', 'crater', 'arena', 'A crater arena where the crowd votes on the next hazard', 'zone'),
    ('Touch Grass', 'plain', '', 'Just grass, and an achievement for touching it. Most visited by far', 'meme'),
    ('The Yellow Rooms', 'backrooms', '', 'Level 0: endless yellow rooms, one exit, a hum that never stops', 'meme'),
    # the Middle Ring
    ('Pineapple Reef', 'reef', 'cabin', 'A pineapple under the sea and a fry-cook quest that never ends', 'pop'),
    ('Broken Fence Isle', 'island', 'lair', 'A theme-park island where the fences already failed', 'pop'),
    ('Castle on the Loch', 'lake', 'castle', 'A wizard school on a cliff; broom races round the towers', 'pop'),
    ('Threadneedle Canyon', 'canyon', 'arch', 'Thread the arch at full speed or kiss the canyon wall', 'pop'),
    ('Rainy Rooftops', 'neon', 'tower', 'Grapple a rainy night city; crime spawns every ten minutes', 'pop'),
    ('Two Sites Town', 'desert', 'ruin', 'Bombsite A, bombsite B, mid doors: rush B at quarter scale', 'game'),
    ('Two Bases Gulch', 'canyon', 'tower', 'Two bases, one canyon, capture the flag forever', 'game'),
    ('Bonfire Ruins', 'ruins', 'ruin', 'Rest at the bonfire; everything else wants you dead', 'game'),
    ('Checker Hill Loop', 'meadow', 'arch', 'Checkered hills and one giant loop; go fast on a hoverboard', 'game'),
    ('Neon Palm Beach', 'island', 'lighthouse', 'Neon sunset, a palm boulevard, a getaway boat at the pier', 'game'),
    ('Thornwall Keep', 'forest', 'castle', 'Siege a keep in the woods, tower by tower', 'zone'),
    ('Frostmaw', 'glacier', 'lair', 'Track an ice wyrm across a cracking glacier', 'zone'),
    ('Lanternmere', 'lake', 'temple', 'Float a lantern for every quest you finished this season', 'zone'),
    ("Kraken's Rest", 'archipelago', 'wreck', 'Pirate coves, sunken gold, tentacles in the shallows', 'zone'),
    ('Blossom Terraces', 'blossom', 'pagoda', 'Climb the monastery terraces through nine trials', 'zone'),
    ('Mirelight Bayou', 'swamp', 'greattree', 'Witch lights in the bayou; follow one and you are lost', 'zone'),
    ('Get-Out Swamp', 'swamp', 'cabin', 'Get out of his swamp: a quest with one step, leave', 'meme'),
    ('Signpost Canyon', 'canyon', '', 'Every signpost promises loot; every signpost is a rickroll', 'meme'),
    ('Such Peak', 'mountain', 'tower', 'Such climb. Very summit. Wow', 'meme'),
    ('Burning Cabin', 'volcano', 'cabin', 'Sit in the burning house with the dog and drink the coffee', 'meme'),
    # the Outer Ring
    ('Rootbound Castle', 'sky', 'castle', 'A floating fortress grown over with roots; the robots still tend it', 'pop'),
    ('Floating Peaks', 'sky', '', 'Floating mountains, glowing nights, a banshee to tame', 'pop'),
    ('Northwall Glacier', 'glacier', 'tower', 'A 300 m ice wall; what lies north is not your problem', 'pop'),
    ('Red Bike Ring', 'neon', '', 'A red-bike drift loop round a neon crater', 'pop'),
    ('Kaiju Bay', 'city', 'lair', 'A harbour city mid-stomp: evacuate, or fight the lizard', 'pop'),
    ('Cocoa Riverworks', 'meadow', 'windmill', 'A chocolate river, candy meadows, a glass lift to nowhere', 'pop'),
    ('Endless Winter Wood', 'snowlake', 'tower', 'Always winter, never Christmas, one lamppost glowing', 'pop'),
    ('Moonlit Crew Bay', 'archipelago', 'wreck', 'A cursed crew that only shows in moonlight', 'pop'),
    ('Ember Mountain', 'volcano', 'citadel', 'One does not simply hoverboard in. Bring a ring', 'pop'),
    ('Second Breakfast Hills', 'meadow', 'greattree', 'Hobbit holes, a party tree, a second-breakfast quest', 'pop'),
    ('Tall Grass Town', 'meadow', 'cabin', 'Two houses, a lab, and tall grass you should not walk in', 'game'),
    ('Blocktown', 'farmland', 'cube', 'A voxel village with a fresh crater where a creeper was', 'game'),
    ('Three Lane Practice', 'steppe', 'tower', 'Three lanes, nine towers, minions that never stop coming', 'game'),
    ('Cannon Hill', 'meadow', 'tower', 'A cannon, a chain chomp, a king at the top of the hill', 'game'),
    ('Pellet Maze', 'maze', '', 'A hedge maze, four ghosts, pellets that respawn at midnight', 'game'),
    ('Last Block Standing', 'ruins', 'tower', 'Survive one block until the helicopter comes', 'game'),
    ('Plunder Isle', 'island', 'wreck', 'Dig up the X, beat the skeletons, sail home rich', 'game'),
    ('Parsnip Farm', 'farmland', 'windmill', 'Parsnips, a community centre, one more day', 'game'),
    ('Islander Getaway', 'island', 'cabin', 'Pay off a raccoon by catching every fish', 'game'),
    ('The Golden Sapling', 'forest', 'greattree', 'A tiny world tree; the tutorial boss still kills everyone', 'game'),
    ('Windhill Hold', 'mountain', 'castle', 'A hilltop hold, a dragon on the porch, an arrow in the knee', 'game'),
    ('Starfall Crater', 'crystal', 'crystal', 'Mine the meteor before the crystal golems wake', 'zone'),
    ('Glasswind Steppe', 'steppe', 'yurts', 'Mounted hunts where the wind sings through glass grass', 'zone'),
    ('Hollowmere Vale', 'valley', '', 'A valley town under two cut-off mountains', 'zone'),
    ('Cinderfall Forge', 'volcano', 'castle', 'Craft at a lava forge while the mountain grumbles', 'zone'),
    ('Mosslight Hollow', 'forest', 'greattree', 'Fae puzzles that rearrange the wood when you look away', 'zone'),
    ('Saltglass Flats', 'saltflat', 'portal', 'Mirage races where the finish line moves', 'zone'),
    ('Thunderhead Spires', 'mountain', 'portal', 'Climb into the storm; lightning resets your checkpoint', 'zone'),
    # the Frontier
    ('Gloamreef', 'reef', 'lighthouse', 'Dusk dives among glowing coral', 'zone'),
    ('Ashen Barrows', 'ruins', 'lair', 'Crypts that refill with the dead every hour', 'zone'),
    ('Only in Ohio', 'farmland', '', 'A normal town where nothing is normal', 'meme'),
    ('Stonks Exchange', 'city', 'tower', 'Line goes up, line goes down, you are the line', 'meme'),
    ('Cat Trail Highway', 'rainbow', '', 'A cat leaves a rainbow and you ride it', 'meme'),
    ('Forty-Minute Flat', 'saltflat', '', 'A forty-minute walk across 500 m; no hoverboards allowed', 'meme'),
    ('Sus Station', 'construction', '', 'Do your tasks; one of the NPCs is not an NPC', 'meme'),
    ('Jawline Gym', 'steppe', 'arena', 'A marble statue, a squat rack, parkour for the jawline', 'meme'),
    ('Caracal Palace', 'oasis', 'temple', 'A caracal on a throne; bring tribute', 'meme'),
    ('Bonk Island', 'island', '', 'Go to jail. A shiba with a bat is waiting', 'meme'),
    ('Rage Quit Tower', 'crystal', 'tower', 'A man in a pot, a hammer, a mountain. Good luck', 'meme'),
    ('Moai Meadow', 'steppe', 'henge', 'Forty stone heads, all looking at you', 'meme'),
    ('Banana for Scale', 'plain', '', 'One 500 m banana, for scale', 'meme'),
    ('Speedrun Box', 'plain', 'cube', 'A box for practising wall clips', 'meme'),
    ('Hampter Hills', 'meadow', '', 'Hamster tunnels under every hill', 'meme'),
    ('Lag Spike', 'saltflat', '', 'A flat plain with one spike; the lag is in the name', 'meme'),
    ('Template 1', 'plain', 'cube', 'The starter template, never renamed', 'half'),
    ('Template 2', 'construction', 'crane', 'The Blender reference, half imported', 'half'),
    ('Untitled Shard (3)', 'plain', 'cube', 'Three uploads, no name, one cube', 'half'),
    ('Plot 41 (unfinished)', 'construction', 'crane', 'Foundations poured in March', 'half'),
    ('Plot 77 (unfinished)', 'construction', 'crane', 'A blueprint grid and a promise', 'half'),
    ("Bob's Test Shard", 'plain', 'cube', 'Bob was testing something', 'half'),
    ('my first shard', 'plain', 'cube', 'Everyone has one', 'half'),
    ('asdf', 'plain', 'cube', 'asdf', 'half'),
    ('Old Mine (abandoned)', 'ruins', 'ruin', 'The author left mid-dungeon', 'half'),
    ('Bramblegate (abandoned)', 'ruins', 'ruin', 'Overgrown since last season', 'half'),
    ('Ruined Chapel (abandoned)', 'lake', 'ruin', 'A chapel the lake took back', 'half'),
    ('Echo Caverns (abandoned)', 'canyon', 'ruin', 'You can still hear the author', 'half'),
    ('Under Construction', 'construction', 'crane', 'Since 2026', 'half'),
    ('Coming Soon™', 'construction', 'crane', 'It is not coming soon', 'half'),
    ('Driftwood Isle', 'island', 'lighthouse', "Founders' demo: the first island", 'half'),
    ('Pine Hollow', 'pine', 'cabin', "Founders' demo: the original pine-forest chunk", 'half'),
    ('Nalati Grasslands', 'steppe', 'yurts', "Founders' demo: riding the steppe", 'half'),
    ('Signal Dunes', 'desert', 'tower', "Founders' demo: signal towers in the sand", 'half'),
    ('Sky Reach', 'sky', 'tower', "Founders' demo: the climb", 'half'),
    ('Nine Dragon Stack', 'neon', 'pagoda', "Founders' demo: the vertical city", 'half'),
]
KINDS = {'pop': 'Pop-culture homages', 'game': 'Tiny copies of real games', 'zone': 'Original MMO zones',
         'meme': 'Memes', 'half': 'Half-built, abandoned, templates and demos'}
assert len(SHARDS) == 100, len(SHARDS)
RING_NAMES = ['The Heart', 'The Inner Ring', 'The Middle Ring', 'The Outer Ring', 'The Frontier']


def ring_of(i, j):
    return min(4, int(max(abs(i - 4.5), abs(j - 4.5)) - 0.5))


# ---------------------------------------------------------------- biomes
# Each writes its design into a window around its cell, in cell units u, v (0..1 over the cell, -0.6..1.6 over the
# window). Heights are absolute (0 low plain .. 1 high peak); `wet` is land (> 0) versus water (< 0).

TREE_KINDS = {
    'green': ('round', [(96, 132, 70), (110, 146, 78), (84, 120, 64), (122, 150, 82)], 6, (3.2, 4.6)),
    'jungle': ('round', [(72, 118, 60), (86, 132, 64), (60, 104, 56), (100, 140, 64)], 5, (3.4, 5.2)),
    'autumn': ('round', [(196, 92, 52), (210, 140, 60), (176, 66, 44), (202, 168, 72), (120, 140, 70)], 6, (3.2, 4.6)),
    'pink': ('round', [(232, 170, 190), (240, 196, 208), (218, 150, 176), (110, 146, 78)], 7, (3.0, 4.2)),
    'willow': ('round', [(112, 132, 86), (98, 120, 80), (126, 140, 96)], 7, (3.2, 4.6)),
    'pine': ('pine', [(62, 96, 66), (54, 86, 60), (72, 106, 72)], 6, (3.4, 4.8)),
    'snowpine': ('snowpine', [(62, 96, 66), (54, 86, 60)], 7, (3.0, 4.2)),
    'palm': ('palm', [(84, 130, 70), (100, 140, 74)], 7, (3.2, 4.2)),
    'reed': ('reed', [(96, 116, 80)], 8, (3, 4)),
    'crystal': ('crystal', [(150, 120, 214), (100, 196, 210), (196, 140, 220)], 7, (3, 6)),
    'dead': ('dead', [(100, 88, 76)], 9, (3, 4)),
    'cactus': ('cactus', [(112, 140, 84)], 10, (2.4, 3.2)),
    'tuft': ('tuft', [(150, 160, 96)], 9, (2.5, 3.5)),
    'flower': ('flower', [(220, 120, 150), (240, 220, 120), (170, 140, 210)], 8, (1.6, 2.2)),
}
GRASS = [(0, (186, 196, 128)), (0.5, (172, 188, 118)), (1, (156, 172, 106))]


class Win:
    def __init__(self, rng):
        self.rng = rng
        x = (np.arange(WN, dtype=np.float32) - WM) / CH
        self.u, self.v = np.meshgrid(x, x)
        self.d0 = np.hypot(self.u - 0.5, self.v - 0.5)
        self.dc = np.maximum(np.abs(self.u - 0.5), np.abs(self.v - 0.5))
        self.inside = smooth(0.62, 0.42, self.dc)       # 1 in the cell, 0 well past its edge
        self.h = np.full((WN, WN), 0.22, np.float32)
        self.wet = np.full((WN, WN), 0.4, np.float32)
        self.col = None
        self.wcol = None
        self.cloud = 0.0
        self.lava = None
        self.dens = {}
        self.hub = (0.5, 0.45)
        self.feats = []          # callables (draw, to_xy) drawn after the trees
        self.houses = 1.0
        self.roads = True

    def n(self, per_cell=3, octaves=5):
        return fbm(self.rng, WN, max(1, round(per_cell * WN / CH)), octaves)

    def r(self, per_cell=3, octaves=5):
        return ridged(self.rng, WN, max(1, round(per_cell * WN / CH)), octaves)


def b_wild(w):
    w.h = 0.2 + 0.12 * w.n(2)
    w.col = ramp(w.n(3), [(0, (196, 198, 150)), (1, (184, 190, 138))])
    w.dens['green'] = smooth(0.6, 0.8, w.n(3)) * 0.3
    w.houses = 0
    w.roads = False


def b_forest(w, kind='green', pal=GRASS, dense=0.92):
    w.h = 0.22 + 0.16 * w.n(3)
    w.col = ramp(w.n(3), pal)
    w.dens[kind] = smooth(0.32, 0.52, w.n(3, 4)) * dense


def b_autumn(w):
    b_forest(w, 'autumn', [(0, (198, 184, 122)), (1, (186, 172, 112))])


def b_pine(w):
    w.h = 0.26 + 0.22 * (w.n(3) * 0.7 + w.r(2) * 0.3)
    w.col = ramp(w.h, [(0.2, (168, 184, 122)), (0.4, (150, 166, 110)), (0.6, (170, 168, 140))])
    w.dens['pine'] = smooth(0.3, 0.5, w.n(3, 4)) * 0.95


def b_jungle(w):
    w.h = 0.2 + 0.14 * w.n(3)
    w.col = ramp(w.n(3), [(0, (132, 166, 96)), (1, (116, 150, 84))])
    w.dens['jungle'] = smooth(0.12, 0.38, w.n(4, 4)) * 0.98


def b_blossom(w):
    t = w.n(2)
    terr = np.floor(t * 9) / 9
    w.h = 0.24 + 0.22 * (terr * 0.7 + t * 0.3) * w.inside
    lines = sum(contour(t * 9, k, 0.8) for k in range(1, 9)) * w.inside
    w.col = mix(ramp(t, [(0, (192, 198, 136)), (1, (178, 186, 124))]), (128, 140, 92), np.clip(lines, 0, 1) * 0.45)
    w.dens['pink'] = smooth(0.4, 0.6, w.n(4, 4)) * 0.75


def b_steppe(w, pal=None):
    w.h = 0.2 + 0.14 * w.n(2)
    w.col = ramp(w.n(2), pal or [(0, (206, 202, 134)), (0.5, (194, 196, 124)), (1, (178, 186, 112))])
    w.dens['tuft'] = smooth(0.55, 0.7, w.n(5, 3)) * 0.35
    w.dens['green'] = smooth(0.72, 0.82, w.n(4, 3)) * 0.6


def b_meadow(w):
    b_steppe(w, [(0, (188, 200, 128)), (1, (168, 186, 112))])
    w.dens['flower'] = smooth(0.5, 0.7, w.n(6, 3)) * 0.3


def b_mountain(w, snow=0.72, pal=None, kind='pine'):
    r = w.r(2, 6)
    w.h = 0.26 + 0.74 * np.clip(r ** 1.5 * 0.85 + w.n(3, 4) * 0.15, 0, 1) * smooth(0.66, 0.2, w.dc)
    w.col = ramp(w.h, pal or [(0.2, (164, 180, 118)), (0.38, (150, 160, 112)), (0.55, (172, 162, 142)),
                              (snow, (206, 200, 190)), (snow + 0.08, (244, 244, 240)), (1, (250, 250, 248))])
    w.dens[kind] = (w.h < 0.48) * smooth(0.3, 0.5, w.n(3, 4)) * 0.9
    tarn = smooth(0.0, 0.03, 0.31 - w.h) * w.inside * (w.rng.random() < 0.6)
    w.wet = 0.4 - 0.5 * tarn


def b_glacier(w):
    b_mountain(w, 0.4, [(0.2, (196, 206, 206)), (0.36, (214, 222, 226)), (0.5, (234, 238, 242)), (1, (252, 252, 252))], 'snowpine')
    crev = sum(contour(w.n(6, 2), 0.5, 0.6) for _ in range(2)) * smooth(0.45, 0.6, w.h)
    w.col = mix(w.col, (150, 176, 196), np.clip(crev, 0, 1) * 0.5)


def b_snowlake(w):
    w.h = 0.22 + 0.1 * w.n(3)
    w.col = ramp(w.n(3), [(0, (230, 236, 238)), (1, (246, 248, 248))])
    w.wet = (w.d0 - 0.2 - 0.1 * (w.n(3) - 0.5)) * 2
    w.wcol = mix((172, 200, 214), (210, 226, 234), w.n(5, 3))
    w.dens['snowpine'] = smooth(0.5, 0.65, w.n(3, 4)) * 0.8
    w.hub = (0.5, 0.78)


def b_desert(w):
    warp = w.n(2, 4)
    a = w.rng.uniform(0, math.pi)
    u = (w.u * math.cos(a) + w.v * math.sin(a)) * 16 + warp * 9
    dunes = (np.sin(u) * 0.5 + 0.5) ** 1.6
    w.h = 0.2 + 0.16 * (dunes * 0.4 + w.n(2, 4) * 0.6)
    w.col = ramp(w.h, [(0.2, (226, 204, 138)), (0.28, (234, 212, 146)), (0.36, (240, 222, 160))])
    w.dens['cactus'] = smooth(0.72, 0.85, w.n(5, 3)) * 0.25


def b_saltflat(w):
    w.h = 0.18 + 0.04 * w.n(2, 4)
    cracks = sum(contour(w.n(8, 2), 0.5, 0.5) for _ in range(3)) * w.inside
    w.col = mix(ramp(w.n(2), [(0, (236, 234, 222)), (1, (246, 244, 236))]), (196, 192, 176), np.clip(cracks, 0, 1) * 0.6)


def b_oasis(w):
    b_desert(w)
    pond = 0.1 + 0.03 * (w.n(4) - 0.5) - np.hypot(w.u - 0.5, w.v - 0.55)
    w.wet = -pond * 3 + 0.02
    w.wcol = np.full((WN, WN, 3), (98, 154, 160), np.float32)
    ring = smooth(0.26, 0.1, np.hypot(w.u - 0.5, w.v - 0.55))
    w.col = mix(w.col, (176, 190, 120), ring * 0.7)
    w.dens = {'palm': ring * 0.8, 'cactus': w.dens['cactus']}
    w.hub = (0.5, 0.36)


def b_canyon(w):
    t = w.n(2, 6)
    mesa = np.floor(t * 7) / 7 * 0.75 + t * 0.25
    gx = 0.5 + 0.12 * np.sin(w.v * 7)
    gorge = np.exp(-((w.u - gx) / 0.05) ** 2) * smooth(0.58, 0.46, w.dc)
    w.h = 0.24 + 0.34 * mesa * smooth(0.62, 0.35, w.dc) * (1 - 0.85 * gorge)
    strata = sum(contour(t * 7, k, 0.7) for k in range(1, 7)) * w.inside
    w.col = mix(ramp(w.h, [(0.2, (186, 128, 86)), (0.32, (198, 128, 84)), (0.45, (214, 156, 104)), (0.58, (226, 182, 128))]), (132, 76, 52), np.clip(strata, 0, 1) * 0.5)
    w.col = mix(ramp(w.n(3), GRASS), w.col, w.inside)
    w.wet = 0.4 - 0.7 * smooth(0.5, 0.85, gorge)
    w.wcol = np.full((WN, WN, 3), (110, 150, 170), np.float32)
    w.dens['green'] = smooth(0.72, 0.85, w.n(4, 3)) * 0.4
    w.hub = (0.5, 0.3)


def b_crater(w):
    d = np.hypot(w.u - 0.5, w.v - 0.48)
    rim = np.exp(-((d - 0.3) / 0.06) ** 2)
    bowl = smooth(0.3, 0.0, d)
    w.h = 0.28 + rim * 0.5 - bowl * 0.12 + w.n(3) * 0.12
    w.col = ramp(w.h, [(0.2, (176, 180, 128)), (0.35, (168, 182, 116)), (0.6, (176, 164, 140)), (0.8, (214, 208, 196))])
    w.dens['green'] = (d > 0.38) * smooth(0.4, 0.6, w.n(3, 4)) * 0.9
    w.hub = (0.5, 0.48)


def b_lake(w):
    lake = 0.3 + 0.08 * (w.n(3) - 0.5) - np.hypot(w.u - 0.5, w.v - 0.46)
    isle = 0.06 - np.hypot(w.u - 0.5, w.v - 0.44)
    w.wet = np.where(isle > 0, isle * 4 + 0.02, -lake * 2.2 + 0.03)
    w.h = 0.2 + 0.14 * w.n(3)
    w.col = ramp(w.n(3), GRASS)
    w.dens['green'] = smooth(0.4, 0.6, w.n(3, 4)) * 0.85
    w.hub = (0.5, 0.44)
    w.lanterns = True


def b_swamp(w):
    w.h = 0.18 + 0.06 * w.n(4)
    pools = 0.36 - w.n(5, 4)
    w.wet = -pools * 1.2 + 0.03
    w.wcol = mix((96, 124, 112), (126, 150, 132), w.n(6, 2))
    w.col = ramp(w.n(3), [(0, (150, 164, 122)), (1, (138, 154, 112))])
    w.dens['reed'] = np.full((WN, WN), 0.45, np.float32)
    w.dens['willow'] = smooth(0.5, 0.7, w.n(3, 4)) * 0.8


def b_crystal(w):
    w.h = 0.28 + 0.42 * (w.r(3) * 0.7 + w.n(2, 4) * 0.3) * smooth(0.62, 0.3, w.dc)
    w.col = ramp(w.h, [(0.25, (160, 146, 160)), (0.45, (168, 152, 172)), (0.7, (198, 188, 200))])
    w.dens['crystal'] = smooth(0.42, 0.6, w.h) * 0.6


def b_volcano(w):
    cx, cy = 0.5, 0.42
    d = np.hypot(w.u - cx, w.v - cy)
    cone = np.clip(1 - d / 0.5, 0, 1) ** 1.25
    crater = np.exp(-(d / 0.055) ** 2)
    w.h = np.clip(0.24 + cone * 0.74 + w.n(4) * 0.06 - crater * 0.3, 0, 1)
    w.col = ramp(w.h, [(0.2, (176, 168, 148)), (0.4, (150, 136, 122)), (0.7, (122, 108, 100)), (1, (96, 86, 82))])
    a = np.arctan2(w.v - cy, w.u - cx)
    flow = np.abs(np.sin(a * 3.5 + w.n(3, 3) * 4 + d * 6))
    lava = smooth(0.14, 0.0, flow) * smooth(0.06, 0.09, d) * smooth(0.46, 0.28, d)
    w.lava = np.maximum(lava, smooth(0.045, 0.03, d))
    w.dens['dead'] = (d > 0.44) * smooth(0.5, 0.7, w.n(3, 3)) * 0.4
    w.hub = (0.5, 0.74)
    w.peak = (cx, cy)


def b_sky(w):
    w.cloud = 1.0
    land = np.full((WN, WN), -1.0, np.float32)
    n = w.n(4, 4)
    spots = [(0.5, 0.45, 0.22)] + [(w.rng.uniform(0.12, 0.88), w.rng.uniform(0.12, 0.88), w.rng.uniform(0.07, 0.12)) for _ in range(5)]
    for sx, sy, sr in spots:
        land = np.maximum(land, 1 - np.hypot(w.u - sx, w.v - sy) / sr + 0.5 * (n - 0.5))
    w.wet = land * 0.4 * w.inside - 0.35 * (1 - w.inside) * 0 + np.minimum(land, 0) * 0.0
    w.wet = np.where(w.inside > 0.05, land * 0.35, -0.4)
    w.h = 0.42 + 0.1 * w.n(3)
    w.col = ramp(w.n(3), GRASS)
    w.dens['green'] = smooth(0.45, 0.65, w.n(3, 4)) * 0.8


def b_reef(w):
    d = np.hypot(w.u - 0.5, w.v - 0.47)
    n = w.n(4)
    ring = 0.035 - np.abs(d - 0.34 - 0.05 * (n - 0.5))
    gaps = smooth(0.4, 0.6, w.n(3, 3) + 0.1)
    w.wet = np.where(ring > 0, ring * 3 * gaps - 0.01 * (1 - gaps), -0.08 - 0.5 * smooth(0.36, 0.7, d))
    lagoon = smooth(0.36, 0.2, d)
    w.wcol = mix(mix((92, 136, 160), (110, 180, 186), smooth(0.6, 0.3, d)), (150, 210, 200), lagoon * 0.8)
    coral = smooth(0.62, 0.75, w.n(6, 3)) * lagoon
    w.wcol = mix(w.wcol, (226, 156, 140), coral * 0.6)
    w.h = 0.18 + 0.04 * n
    w.col = ramp(n, [(0, (232, 220, 176)), (1, (214, 210, 150))])
    w.dens['palm'] = np.full((WN, WN), 0.5, np.float32)
    w.hub = (0.5, 0.46)


def b_island(w):
    v = 0.36 - w.d0 + 0.2 * (w.n(3) - 0.5)
    w.wet = v * 1.2
    w.h = 0.18 + np.clip(v, 0, None) * 0.9 + 0.08 * w.n(3)
    beach = smooth(0.1, 0.0, v)
    w.col = mix(ramp(w.n(3), GRASS), (232, 218, 172), beach)
    w.dens['palm' if w.rng.random() < 0.5 else 'green'] = (v > 0.08) * smooth(0.4, 0.6, w.n(3, 4)) * 0.85
    w.hub = (0.5, 0.44)


def b_archipelago(w):
    v = w.n(4) - 0.6 + 0.25 * (1 - w.d0 / 0.6)
    w.wet = v * 1.2
    w.h = 0.18 + np.clip(v, 0, None) * 1.2
    beach = smooth(0.05, 0.0, v)
    w.col = mix(ramp(w.n(3), GRASS), (232, 218, 172), beach)
    w.dens['palm'] = (v > 0.04) * 0.7
    w.hub = (0.52, 0.5)


def b_ruins(w):
    w.h = 0.22 + 0.12 * w.n(3)
    w.col = ramp(w.n(3), [(0, (178, 172, 152)), (1, (160, 152, 136))])
    w.dens['dead'] = smooth(0.5, 0.7, w.n(4, 3)) * 0.35
    w.houses = 0.3


def b_farmland(w):
    rng = w.rng
    w.h = 0.2 + 0.1 * w.n(2)
    base = ramp(w.n(3), GRASS)
    fields = [(198, 186, 112), (178, 190, 112), (212, 198, 128), (158, 176, 100), (202, 172, 106)]
    img = Image.new('RGB', (WN, WN))
    d = ImageDraw.Draw(img)
    for _ in range(40):
        fx, fy = rng.uniform(WM * 0.6, WN - WM * 0.6), rng.uniform(WM * 0.6, WN - WM * 0.6)
        fw, fh = rng.uniform(20, 46), rng.uniform(16, 36)
        d.rectangle([fx, fy, fx + fw, fy + fh], fill=fields[rng.integers(len(fields))])
    arr = np.asarray(img).astype(np.float32)
    has = (arr.sum(-1) > 0).astype(np.float32) * w.inside
    w.col = mix(base, arr, has * 0.85)
    w.dens['green'] = (1 - has) * 0.35
    w.houses = 1.6


def b_city(w, neon=False):
    rng = w.rng
    b_forest(w, 'green', GRASS, 0.5)
    cd = np.hypot(w.u - 0.5, w.v - 0.48)
    w.dens['green'] = w.dens['green'] * smooth(0.4, 0.5, cd)
    plaster = (196, 184, 186) if neon else (212, 198, 168)
    w.col = mix(w.col, plaster, smooth(0.47, 0.43, cd))
    w.city_r, w.city_c = 0.44, (0.5, 0.48)
    canal = np.exp(-((w.v - 0.62 - 0.05 * np.sin(w.u * 9)) / 0.02) ** 2) * w.inside
    w.wet = 0.4 - 0.8 * smooth(0.4, 0.7, canal)
    w.wcol = np.full((WN, WN, 3), (96, 120, 150) if neon else (118, 154, 174), np.float32)
    w.houses = 0
    w.hub = (0.5, 0.48)
    w.city = 'neon' if neon else 'walled'

    def draw(d, xy):
        cx, cy = xy(0.5, 0.48)
        r = C * 0.44
        roof = [(176, 92, 66), (160, 80, 60), (190, 120, 84), (150, 100, 80)]
        nroof = [(176, 96, 140), (92, 150, 172), (140, 108, 160), (190, 120, 150)]
        for gy in range(int(cy - r), int(cy + r), 9):
            for gx in range(int(cx - r), int(cx + r), 9):
                if math.hypot(gx + 4 - cx, gy + 4 - cy) > r - 6 or rng.random() < 0.18:
                    continue
                if abs(gx + 4 - cx) < 6 or abs(gy + 4 - cy) < 6:
                    continue
                _, canal_y = xy(0, 0.62 + 0.05 * math.sin(((gx - cx) / C + 0.5) * 9))
                if abs(gy + 4 - canal_y) < 8:
                    continue
                sz = rng.uniform(4.5, 7)
                col = (nroof if neon else roof)[rng.integers(4)]
                d.rectangle([gx + 1, gy + 1, gx + sz, gy + sz], fill=col, outline=shade_col(col, 0.6))
        if neon:
            for _ in range(70):
                a, rr = rng.uniform(0, 2 * math.pi), r * math.sqrt(rng.random()) * 0.95
                lx, ly = cx + rr * math.cos(a), cy + rr * math.sin(a)
                col = [(255, 80, 180), (80, 230, 255), (255, 200, 80)][rng.integers(3)]
                d.ellipse([lx - 4, ly - 4, lx + 4, ly + 4], fill=col + (55,))
                d.ellipse([lx - 1.4, ly - 1.4, lx + 1.4, ly + 1.4], fill=col)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(200, 80, 160), width=3)
        else:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=INK, width=3)
        for k in range(12):
            a = k / 12 * 2 * math.pi + 0.26
            tx, ty = cx + r * math.cos(a), cy + r * math.sin(a)
            d.ellipse([tx - 3.5, ty - 3.5, tx + 3.5, ty + 3.5], fill=(204, 192, 172), outline=INK)
    w.feats.append(draw)


def b_neon(w):
    b_city(w, True)


def b_tiered(w):
    """A seven-walled white city climbing a hill, split by a great prow of rock."""
    rng = w.rng
    b_forest(w, 'green', GRASS, 0.6)
    cd = np.hypot(w.u - 0.5, w.v - 0.52)
    w.h = w.h + 0.46 * smooth(0.48, 0.04, cd)
    w.dens['green'] = w.dens['green'] * smooth(0.45, 0.53, cd)
    w.col = mix(w.col, (228, 224, 212), smooth(0.48, 0.44, cd))
    w.houses = 0
    w.hub = (0.5, 0.52)
    w.city = 'tiered'
    w.city_r, w.city_c = 0.46, (0.5, 0.52)
    prow = rng.uniform(0, 2 * math.pi)

    def draw(d, xy):
        cx, cy = xy(0.5, 0.52)
        R = C * 0.46
        rings = 7
        slate = [(222, 220, 212), (208, 210, 214), (232, 228, 218), (186, 194, 206)]
        for k in range(rings):
            r_out = R * (1 - k / (rings + 0.6))
            r_in = R * (1 - (k + 1) / (rings + 0.6))
            for rr in np.arange(r_in + 5, r_out - 3, 5.5):
                n_ = int(2 * math.pi * rr / 6)
                for q in range(n_):
                    a = q / n_ * 2 * math.pi
                    if abs(((a - prow + math.pi) % (2 * math.pi)) - math.pi) < 0.1 or rng.random() < 0.22:
                        continue
                    px, py = cx + rr * math.cos(a), cy + rr * math.sin(a)
                    col = slate[rng.integers(4)]
                    d.rectangle([px - 2.1, py - 2.1, px + 2.1, py + 2.1], fill=col, outline=shade_col(col, 0.62))
            d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], outline=(92, 86, 80), width=6)
            d.ellipse([cx - r_out + 1, cy - r_out + 1, cx + r_out - 1, cy + r_out - 1], outline=(246, 244, 238), width=3)
        tip = (cx + R * 1.04 * math.cos(prow), cy + R * 1.04 * math.sin(prow))
        d.line([(cx, cy), tip], fill=(92, 86, 80), width=10)
        d.line([(cx, cy), tip], fill=(238, 234, 224), width=6)
        rc = R * (1 - rings / (rings + 0.6))
        d.ellipse([cx - rc, cy - rc, cx + rc, cy + rc], fill=(242, 240, 232), outline=INK, width=2)
        icon(d, 'tower', cx, cy - 2, 15)
    w.feats.append(draw)


def b_plain(w):
    w.h = np.full((WN, WN), 0.2, np.float32)
    w.col = mix(ramp(w.n(3), GRASS), (174, 192, 140), w.inside)
    w.dens['green'] = (1 - smooth(0.4, 0.6, w.dc)) * 0
    w.houses = 0
    w.hub = (0.5, 0.5)


def b_construction(w):
    w.h = 0.2 + 0.08 * w.n(3) * (1 - w.inside)
    grid = ((np.mod(w.u * C, 20) < 1) | (np.mod(w.v * C, 20) < 1)).astype(np.float32)
    w.col = mix(ramp(w.n(3), GRASS), (214, 200, 168), w.inside)
    w.col = mix(w.col, (140, 160, 190), grid * 0.55 * smooth(0.5, 0.42, w.dc))
    w.houses = 0
    w.hub = (0.5, 0.5)
    rng = w.rng

    def draw(d, xy):
        for _ in range(6):
            bx, by = xy(rng.uniform(0.15, 0.75), rng.uniform(0.15, 0.75))
            d.rectangle([bx, by, bx + rng.uniform(16, 40), by + rng.uniform(14, 30)], outline=(90, 110, 150), width=2)
    w.feats.append(draw)


def b_dune(w):
    a = w.rng.uniform(0, math.pi)
    u = (w.u * math.cos(a) + w.v * math.sin(a)) * 11 + w.n(2, 4) * 7
    dunes = (np.sin(u) * 0.5 + 0.5) ** 1.3
    w.h = 0.2 + 0.3 * (dunes * 0.6 + w.n(2, 4) * 0.4)
    w.col = ramp(w.h, [(0.2, (212, 160, 96)), (0.35, (226, 178, 110)), (0.5, (240, 204, 140))])
    w.hub = (0.5, 0.3)

    def draw(d, xy):
        pts = [xy(0.16 + 0.66 * t, 0.6 + 0.13 * math.sin(t * 6.5)) for t in np.linspace(0, 1, 44)]
        d.line(pts, fill=(150, 104, 64, 70), width=30, joint='curve')
        d.line(pts, fill=(112, 78, 50), width=15, joint='curve')
        d.line(pts, fill=(198, 148, 92), width=10, joint='curve')
        for q in range(2, 42, 3):
            (ax, ay), (bx, by) = pts[q - 1], pts[q + 1]
            ln = math.hypot(bx - ax, by - ay) + 1e-6
            nx, ny = -(by - ay) / ln, (bx - ax) / ln
            d.line([(pts[q][0] - nx * 6, pts[q][1] - ny * 6), (pts[q][0] + nx * 6, pts[q][1] + ny * 6)], fill=(110, 78, 50), width=1)
        hx, hy = pts[-1]
        d.ellipse([hx - 12, hy - 12, hx + 12, hy + 12], fill=(70, 46, 32), outline=INK, width=2)
        for k in range(14):
            a2 = k / 14 * 2 * math.pi
            d.line([(hx + 5 * math.cos(a2), hy + 5 * math.sin(a2)), (hx + 10 * math.cos(a2), hy + 10 * math.sin(a2))], fill=(236, 224, 200), width=1)
        cx, cy = xy(0.36, 0.32)
        d.ellipse([cx + 4, cy - 16, cx + 40, cy + 2], fill=(214, 182, 132, 110))
        d.rectangle([cx - 9, cy - 6, cx + 9, cy + 6], fill=(184, 176, 160), outline=INK, width=2)
    w.feats.append(draw)


def b_kai(w):
    """A tiny round planet at the end of a long serpent road over the clouds."""
    w.cloud = 1.0
    cx, cy, R = 0.66, 0.42, 0.1
    dd = np.hypot(w.u - cx, w.v - cy)
    w.wet = np.where(dd < R, (R - dd) * 4 + 0.01, -0.4).astype(np.float32)
    dome = np.sqrt(np.clip(1 - (dd / R) ** 2, 0, 1))
    w.h = 0.3 + 0.35 * dome
    w.col = ramp(dome, [(0, (120, 170, 80)), (1, (172, 208, 112))])
    w.hub = (cx, cy)
    w.houses = 0

    def draw(d, xy):
        px, py = xy(cx, cy)
        Rp = R * C
        d.arc([px - Rp + 2, py - Rp + 2, px + Rp - 2, py + Rp - 2], 30, 150, fill=(80, 104, 56), width=3)
        d.pieslice([px - 9, py - 13, px + 9, py + 5], 180, 360, fill=(238, 228, 202), outline=INK, width=1)
        d.ellipse([px - 4, py - 16, px + 4, py - 10], fill=(196, 64, 48), outline=INK)
        d.line([(px - 9, py - 4), (px + 9, py - 4)], fill=INK, width=1)
        tree_glyph(d, px + 17, py - 3, 'round', 5.5, (96, 140, 70))
        d.rectangle([px - 22, py + 6, px - 13, py + 11], fill=(200, 60, 48), outline=INK)
    w.feats.append(draw)


def b_wowcity(w):
    """A great walled capital: octagonal walls, a ring canal, a cathedral, the keep and a harbour."""
    rng = w.rng
    b_forest(w, 'green', GRASS, 0.5)
    c = (0.5, 0.5)
    du, dv = np.abs(w.u - c[0]), np.abs(w.v - c[1])
    octd = np.maximum(np.maximum(du, dv), (du + dv) / 1.3)
    w.dens['green'] = w.dens['green'] * smooth(0.44, 0.5, octd)
    w.col = mix(w.col, (214, 208, 194), smooth(0.47, 0.43, octd))
    rd = np.hypot(w.u - c[0], w.v - c[1])
    canal = smooth(0.014, 0.0, np.abs(rd - 0.22)) + smooth(0.012, 0.0, du) * (rd > 0.24) * (w.v > c[1]) * (octd < 0.45)
    w.wet = 0.4 - 0.8 * np.clip(canal, 0, 1)
    w.wet = np.minimum(w.wet, (np.hypot(w.u - 1.02, w.v - 1.02) - 0.3) * 2)
    w.wcol = np.full((WN, WN, 3), (104, 140, 170), np.float32)
    w.houses = 0
    w.hub = c
    w.city = 'walled'
    w.city_r, w.city_c = 0.45, c

    def draw(d, xy):
        cx, cy = xy(*c)
        R = C * 0.45
        slate = [(92, 112, 150), (110, 128, 164), (84, 100, 136), (140, 150, 170)]
        for gy in range(int(cy - R), int(cy + R), 8):
            for gx in range(int(cx - R), int(cx + R), 8):
                dx, dy = gx + 3 - cx, gy + 3 - cy
                if max(abs(dx), abs(dy), (abs(dx) + abs(dy)) / 1.3) > R - 8 or rng.random() < 0.15:
                    continue
                rr = math.hypot(dx, dy)
                if abs(rr - 0.22 * C) < 7 or (abs(dx) < 6 and dy > 0.2 * C) or (abs(dx) < 34 and -0.42 * C < dy < -0.16 * C) or rr < 16:
                    continue
                col = slate[rng.integers(4)]
                sz = rng.uniform(3.5, 5.5)
                d.rectangle([gx, gy, gx + sz, gy + sz], fill=col, outline=shade_col(col, 0.6))
        oct_pts = [(cx + R * math.cos(math.pi / 8 + k * math.pi / 4) / math.cos(math.pi / 8), cy + R * math.sin(math.pi / 8 + k * math.pi / 4) / math.cos(math.pi / 8)) for k in range(8)]
        oct_pts = [(cx + (x_ - cx) * 0.92, cy + (y_ - cy) * 0.92) for x_, y_ in oct_pts]
        d.line(oct_pts + [oct_pts[0]], fill=(90, 86, 82), width=8, joint='curve')
        d.line(oct_pts + [oct_pts[0]], fill=(240, 236, 228), width=4, joint='curve')
        for x_, y_ in oct_pts:
            d.ellipse([x_ - 6, y_ - 6, x_ + 6, y_ + 6], fill=(232, 228, 218), outline=INK, width=2)
            d.polygon([(x_ - 5, y_ - 4), (x_, y_ - 12), (x_ + 5, y_ - 4)], fill=(70, 96, 150), outline=INK)
        bx, by = xy(0.36, 0.47)
        d.rectangle([bx - 22, by - 6, bx + 22, by + 6], fill=(232, 228, 218), outline=INK, width=2)
        d.rectangle([bx - 6, by - 15, bx + 6, by + 15], fill=(232, 228, 218), outline=INK, width=2)
        d.ellipse([bx - 4, by - 4, bx + 4, by + 4], fill=(70, 96, 150), outline=INK)
        kx, ky = xy(0.5, 0.24)
        icon(d, 'castle', kx, ky, 15)
        d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=(226, 220, 206), outline=INK, width=2)
    w.feats.append(draw)


def b_valley(w):
    """A valley town: mountains along two edges (cut off where the plot ends), forest, a river into a lake."""
    r = w.r(2, 6)
    band = smooth(0.52, 0.95, np.maximum(1 - w.v, w.u))
    w.h = 0.24 + 0.72 * np.clip(r ** 1.4 * 0.8 + w.n(3, 4) * 0.2, 0, 1) * band + 0.05 * w.n(3)
    w.col = ramp(w.h, [(0.2, (170, 186, 120)), (0.4, (150, 162, 112)), (0.55, (172, 162, 142)), (0.68, (206, 200, 190)), (0.76, (244, 244, 240)), (1, (250, 250, 248))])
    lake = 0.13 + 0.04 * (w.n(3) - 0.5) - np.hypot(w.u - 0.28, w.v - 0.74)
    w.wet = np.where(lake > 0, -lake * 3 - 0.01, 0.4).astype(np.float32)
    w.dens['pine'] = (w.h < 0.5) * (w.h > 0.3) * smooth(0.3, 0.5, w.n(3, 4)) * 0.9
    w.dens['green'] = (w.h <= 0.3) * smooth(0.45, 0.6, w.n(3, 4)) * 0.7
    w.hub = (0.44, 0.6)

    def draw(d, xy):
        pts = cubic(xy(0.76, 0.2), xy(0.62, 0.46), xy(0.5, 0.42), xy(0.36, 0.66), 30)
        for q in range(len(pts) - 1):
            wd = 1.6 + 2.8 * q / (len(pts) - 1)
            d.line([pts[q], pts[q + 1]], fill=(86, 124, 156), width=int(wd + 2))
        for q in range(len(pts) - 1):
            wd = 1.6 + 2.8 * q / (len(pts) - 1)
            d.line([pts[q], pts[q + 1]], fill=(126, 164, 188), width=max(1, int(wd)))
    w.feats.append(draw)


def b_rainbow(w):
    """Nothing but void and a rainbow road from one entry to the far one."""
    w.cloud = 1.0
    w.wet = np.full((WN, WN), -0.4, np.float32)
    w.h = np.full((WN, WN), 0.3, np.float32)
    w.col = ramp(w.n(3), GRASS)
    w.houses = 0


def b_maze(w, yellow=False):
    """A maze plot: the Backrooms' yellow office walls, or a hedge maze with pellets."""
    rng = w.rng
    w.h = np.full((WN, WN), 0.2, np.float32)
    w.col = np.broadcast_to(np.array((226, 210, 128) if yellow else (172, 196, 128), np.float32), (WN, WN, 3)).copy()
    w.houses = 0
    w.hub = (0.5, 0.5)

    def draw(d, xy):
        step = 16
        x0, y0 = xy(0.04, 0.04)
        n = int(C * 0.92 / step)
        wall = (160, 140, 64) if yellow else (60, 104, 58)
        wd = 2 if yellow else 4
        for a in range(n + 1):
            for b in range(n + 1):
                px, py = x0 + a * step, y0 + b * step
                if rng.random() < 0.55 and a < n:
                    d.line([(px, py), (px + step, py)], fill=wall, width=wd)
                if rng.random() < 0.45 and b < n:
                    d.line([(px, py), (px, py + step)], fill=wall, width=wd)
                if not yellow and a < n and b < n and rng.random() < 0.5:
                    d.ellipse([px + 7, py + 7, px + 9, py + 9], fill=(250, 240, 190))
        if not yellow:
            for gx, gy, col in ((0.3, 0.3, (220, 60, 60)), (0.7, 0.35, (240, 150, 200)), (0.35, 0.7, (90, 200, 230)), (0.68, 0.66, (240, 170, 70))):
                cx, cy = xy(gx, gy)
                d.pieslice([cx - 6, cy - 6, cx + 6, cy + 6], 180, 360, fill=col, outline=INK)
                d.rectangle([cx - 6, cy, cx + 6, cy + 4], fill=col, outline=INK)
    w.feats.append(draw)


def b_placeholder(w):
    """What the server puts in a plot nobody has uploaded to yet."""
    w.h = 0.2 + 0.05 * w.n(2)
    w.col = ramp(w.n(3), [(0, (198, 204, 164)), (1, (188, 198, 154))])
    w.dens['tuft'] = smooth(0.6, 0.8, w.n(4, 3)) * 0.25
    w.houses = 0


BIOMES = {
    'wild': b_wild, 'forest': b_forest, 'pine': b_pine, 'jungle': b_jungle, 'autumn': b_autumn, 'blossom': b_blossom,
    'steppe': b_steppe, 'meadow': b_meadow, 'mountain': b_mountain, 'glacier': b_glacier, 'snowlake': b_snowlake,
    'desert': b_desert, 'saltflat': b_saltflat, 'oasis': b_oasis, 'canyon': b_canyon, 'crater': b_crater,
    'lake': b_lake, 'swamp': b_swamp, 'crystal': b_crystal, 'volcano': b_volcano, 'sky': b_sky, 'reef': b_reef,
    'island': b_island, 'archipelago': b_archipelago, 'ruins': b_ruins, 'farmland': b_farmland, 'city': b_city,
    'neon': b_neon, 'tiered': b_tiered, 'plain': b_plain, 'construction': b_construction,
    'dune': b_dune, 'kai': b_kai, 'wowcity': b_wowcity, 'valley': b_valley, 'placeholder': b_placeholder,
    'rainbow': b_rainbow, 'backrooms': lambda w: b_maze(w, True), 'maze': b_maze,
}
# What each shard builds past its ramps (Jake, round 3): the grid only owns the ramps.
ROAD_STYLE = {
    'forest': 'trail', 'pine': 'none', 'jungle': 'trail', 'autumn': 'none', 'blossom': 'trail', 'steppe': 'through',
    'meadow': 'through', 'mountain': 'trail', 'glacier': 'none', 'snowlake': 'none', 'desert': 'through',
    'saltflat': 'through', 'oasis': 'trail', 'canyon': 'through', 'crater': 'trail', 'lake': 'trail', 'swamp': 'none',
    'crystal': 'none', 'volcano': 'trail', 'sky': 'landing', 'reef': 'dock', 'island': 'dock', 'archipelago': 'dock',
    'ruins': 'old', 'farmland': 'through', 'city': 'city', 'neon': 'city', 'tiered': 'city', 'plain': 'none',
    'construction': 'none', 'dune': 'none', 'kai': 'serpent', 'wowcity': 'city', 'valley': 'through',
    'placeholder': 'none', 'rainbow': 'rainbow', 'backrooms': 'none', 'maze': 'none',
}
SEA_DEEP, SEA_SHALLOW = (96, 132, 156), (136, 170, 180)


# ---------------------------------------------------------------- glyphs (Vaelmora-sized)

def tree_glyph(d, x, y, kind, r, col):
    if kind == 'round':
        d.ellipse([x - r + 1.3, y - r + 1.8, x + r + 1.3, y + r + 1.8], fill=(40, 46, 24, 70))
        d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=shade_col(col, 0.58))
        hr = r * 0.38
        d.ellipse([x - r * 0.4 - hr, y - r * 0.4 - hr, x - r * 0.4 + hr, y - r * 0.4 + hr], fill=shade_col(col, 1.22))
    elif kind in ('pine', 'snowpine'):
        pts = [(x, y - r * 1.7), (x - r * 0.95, y + r * 0.6), (x + r * 0.95, y + r * 0.6)]
        d.polygon([(px + 1.4, py + 1.6) for px, py in pts], fill=(30, 40, 24, 80))
        d.polygon(pts, fill=col, outline=shade_col(col, 0.6))
        d.line([(x, y - r * 1.5), (x - r * 0.5, y + r * 0.4)], fill=shade_col(col, 1.3))
        if kind == 'snowpine':
            d.polygon([(x, y - r * 1.7), (x - r * 0.4, y - r * 0.7), (x + r * 0.4, y - r * 0.7)], fill=(246, 248, 250))
    elif kind == 'palm':
        for k in range(5):
            a = k / 5 * 2 * math.pi + 0.3
            d.line([(x, y), (x + r * 1.3 * math.cos(a), y + r * 1.3 * math.sin(a))], fill=col, width=2)
        d.ellipse([x - 1.4, y - 1.4, x + 1.4, y + 1.4], fill=(110, 84, 54))
    elif kind == 'reed':
        for k in (-1, 0, 1):
            d.line([(x + k * 1.6, y + 2), (x + k * 2.2, y - r)], fill=col, width=1)
    elif kind == 'tuft':
        d.line([(x - 2, y), (x - 3, y - r)], fill=col)
        d.line([(x, y), (x, y - r - 1)], fill=col)
        d.line([(x + 2, y), (x + 3, y - r)], fill=col)
    elif kind == 'flower':
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    elif kind == 'cactus':
        d.line([(x, y + r), (x, y - r * 1.2)], fill=col, width=2)
        d.line([(x - r * 0.7, y - r * 0.2), (x - r * 0.7, y - r * 0.7)], fill=col, width=1)
        d.line([(x - r * 0.7, y - r * 0.2), (x, y - r * 0.2)], fill=col, width=1)
    elif kind == 'crystal':
        pts = [(x, y - r * 1.8), (x + r * 0.55, y), (x, y + r * 0.5), (x - r * 0.55, y)]
        d.polygon([(px + 2, py + 2) for px, py in pts], fill=(40, 30, 50, 80))
        d.polygon(pts, fill=col, outline=shade_col(col, 0.55))
        d.line([(x, y - r * 1.6), (x - r * 0.3, y)], fill=(250, 246, 255))
    elif kind == 'dead':
        d.line([(x, y + r), (x, y - r)], fill=col)
        d.line([(x, y - r * 0.2), (x - r * 0.7, y - r * 0.8)], fill=col)
        d.line([(x, y), (x + r * 0.7, y - r * 0.6)], fill=col)


def peak_glyph(d, x, y, s, smoke=False):
    left = [(x, y - s), (x - s * 0.9, y + s * 0.35), (x, y + s * 0.35)]
    right = [(x, y - s), (x + s * 0.9, y + s * 0.35), (x, y + s * 0.35)]
    d.polygon(left, fill=(242, 240, 234), outline=(110, 100, 92))
    d.polygon(right, fill=(156, 148, 140), outline=(110, 100, 92))
    if smoke:
        for k in range(5):
            d.ellipse([x - 5 + k * 4, y - s - 8 - k * 9, x + 5 + k * 5, y - s - k * 9], fill=(120, 114, 110, 120))


def house_glyph(d, x, y, s, roof=(176, 92, 66)):
    d.rectangle([x - s, y - s * 0.4, x + s, y + s * 0.7], fill=(230, 218, 190), outline=INK)
    d.polygon([(x - s * 1.2, y - s * 0.3), (x, y - s * 1.2), (x + s * 1.2, y - s * 0.3)], fill=roof, outline=INK)


def icon(d, kind, x, y, s, neon=False):
    """A landmark map symbol, ~2s tall, in Vaelmora's fine ink-and-wash manner."""
    I = INK
    lw = 1 if s < 14 else 2
    if kind in ('castle', 'citadel'):
        dark = kind == 'citadel'
        wall = (96, 82, 78) if dark else (220, 210, 188)
        roof = (196, 64, 44) if dark else (170, 70, 52)
        d.rectangle([x - s, y - s * 0.2, x + s, y + s * 0.6], fill=wall, outline=I, width=lw)
        for tx, th in ((-s, 0.9), (s, 0.9), (0, 1.3)):
            d.rectangle([x + tx - s * 0.24, y - s * th, x + tx + s * 0.24, y + s * 0.6], fill=wall, outline=I, width=lw)
            d.polygon([(x + tx - s * 0.32, y - s * th), (x + tx, y - s * th - s * 0.55), (x + tx + s * 0.32, y - s * th)], fill=roof, outline=I)
        d.rectangle([x - s * 0.14, y + s * 0.25, x + s * 0.14, y + s * 0.6], fill=(70, 50, 40))
    elif kind == 'pagoda':
        cols = [(214, 70, 60), (60, 140, 140)] if not neon else [(240, 70, 160), (60, 200, 230)]
        tiers = 4
        for k in range(tiers):
            w = s * (1.0 - k * 0.17)
            ty = y + s * 0.6 - k * s * 0.42
            d.rectangle([x - w * 0.5, ty - s * 0.26, x + w * 0.5, ty], fill=(236, 222, 190), outline=I)
            d.polygon([(x - w * 0.9, ty - s * 0.2), (x - w * 0.55, ty - s * 0.44), (x + w * 0.55, ty - s * 0.44), (x + w * 0.9, ty - s * 0.2)], fill=cols[k % 2], outline=I)
        d.line([(x, y + s * 0.6 - tiers * s * 0.42 - s * 0.05), (x, y + s * 0.6 - tiers * s * 0.42 - s * 0.45)], fill=I, width=lw)
    elif kind == 'colossus':
        stone = (150, 170, 150)
        d.polygon([(x - s * 0.4, y + s * 0.7), (x - s * 0.28, y - s * 0.55), (x + s * 0.28, y - s * 0.55), (x + s * 0.4, y + s * 0.7)], fill=stone, outline=I, width=lw)
        d.ellipse([x - s * 0.2, y - s * 0.98, x + s * 0.2, y - s * 0.56], fill=stone, outline=I, width=lw)
        d.line([(x + s * 0.28, y - s * 0.45), (x + s * 0.7, y - s * 1.05)], fill=I, width=max(2, int(s * 0.18)))
        d.line([(x + s * 0.7, y - s * 1.45), (x + s * 0.7, y - s * 0.7)], fill=(226, 216, 166), width=2)
        for k in range(3):
            d.arc([x - s * (0.6 + k * 0.25), y + s * (0.5 + k * 0.05), x + s * (0.6 + k * 0.25), y + s * (0.8 + k * 0.08)], 0, 180, fill=(240, 248, 250), width=1)
    elif kind == 'airship':
        for ox, oy, ss in ((0, 0, 1.0), (-1.7, 1.2, 0.5), (1.6, 1.0, 0.45)):
            ax, ay, sz = x + ox * s, y + oy * s, s * ss
            d.ellipse([ax - sz + 4, ay - sz * 0.4 + 10, ax + sz + 4, ay + sz * 0.4 + 10], fill=(60, 70, 90, 50))
            d.ellipse([ax - sz, ay - sz * 0.4, ax + sz, ay + sz * 0.4], fill=(236, 226, 200), outline=I, width=lw)
            for f in (-0.45, 0, 0.45):
                d.line([(ax + f * sz, ay - sz * 0.37), (ax + f * sz, ay + sz * 0.37)], fill=(190, 70, 52), width=1)
            d.rectangle([ax - sz * 0.3, ay + sz * 0.45, ax + sz * 0.3, ay + sz * 0.62], fill=(140, 96, 60), outline=I)
    elif kind in ('tower', 'lighthouse'):
        lh = kind == 'lighthouse'
        d.polygon([(x - s * 0.3, y + s * 0.6), (x - s * 0.2, y - s), (x + s * 0.2, y - s), (x + s * 0.3, y + s * 0.6)], fill=(232, 224, 204), outline=I, width=lw)
        if lh:
            for k in range(3):
                yy = y - s * 0.6 + k * s * 0.45
                d.rectangle([x - s * 0.26, yy, x + s * 0.26, yy + s * 0.18], fill=(196, 64, 52))
            d.ellipse([x - s * 0.6, y - s * 1.55, x + s * 0.6, y - s * 0.65], fill=(255, 230, 140, 90))
        d.polygon([(x - s * 0.3, y - s), (x, y - s * 1.5), (x + s * 0.3, y - s)], fill=(170, 70, 52) if not lh else (70, 60, 50), outline=I)
    elif kind == 'temple':
        d.polygon([(x - s, y - s * 0.35), (x, y - s * 0.9), (x + s, y - s * 0.35)], fill=(220, 206, 176), outline=I, width=lw)
        d.rectangle([x - s * 0.9, y - s * 0.35, x + s * 0.9, y + s * 0.5], fill=(236, 226, 204), outline=I, width=lw)
        for k in range(-3, 4):
            d.line([(x + k * s * 0.25, y - s * 0.25), (x + k * s * 0.25, y + s * 0.4)], fill=I)
    elif kind == 'ziggurat':
        for k in range(4):
            w = s * (1.0 - k * 0.22)
            ty = y + s * 0.6 - k * s * 0.34
            d.rectangle([x - w, ty - s * 0.34, x + w, ty], fill=(176, 170, 140), outline=I, width=lw)
        d.rectangle([x - s * 0.22, y - s * 1.05, x + s * 0.22, y - s * 0.76], fill=(196, 180, 140), outline=I)
    elif kind == 'lair':
        d.ellipse([x - s * 0.55, y - s * 0.55, x + s * 0.55, y + s * 0.55], outline=(176, 40, 36), width=2)
        d.ellipse([x - s * 0.24, y - s * 0.24, x + s * 0.24, y + s * 0.24], fill=(196, 52, 44), outline=(120, 30, 26))
    elif kind == 'portal':
        d.ellipse([x - s * 0.6, y - s * 1.0, x + s * 0.6, y + s * 0.45], fill=(120, 230, 230, 60), outline=(60, 150, 160), width=lw + 1)
        d.rectangle([x - s * 0.75, y + s * 0.4, x + s * 0.75, y + s * 0.55], fill=(170, 160, 150), outline=I)
    elif kind == 'dome':
        d.pieslice([x - s * 0.75, y - s * 1.1, x + s * 0.75, y + s * 0.2], 180, 360, fill=(120, 170, 150), outline=I, width=lw)
        d.rectangle([x - s, y - s * 0.45, x + s, y + s * 0.5], fill=(226, 214, 186), outline=I, width=lw)
        for k in range(-3, 4):
            d.line([(x + k * s * 0.28, y - s * 0.35), (x + k * s * 0.28, y + s * 0.4)], fill=I)
    elif kind == 'windmill':
        d.polygon([(x - s * 0.3, y + s * 0.6), (x - s * 0.18, y - s * 0.4), (x + s * 0.18, y - s * 0.4), (x + s * 0.3, y + s * 0.6)], fill=(232, 222, 200), outline=I, width=lw)
        for k in range(4):
            a = k / 4 * 2 * math.pi + 0.5
            d.line([(x, y - s * 0.4), (x + s * 0.9 * math.cos(a), y - s * 0.4 + s * 0.9 * math.sin(a))], fill=I, width=lw)
    elif kind == 'wreck':
        d.polygon([(x - s, y), (x + s * 0.8, y - s * 0.3), (x + s * 0.6, y + s * 0.3), (x - s * 0.7, y + s * 0.45)], fill=(132, 96, 64), outline=I, width=lw)
        d.line([(x - s * 0.2, y - s * 0.1), (x - s * 0.5, y - s * 1.1)], fill=I, width=lw + 1)
        d.polygon([(x - s * 0.45, y - s * 0.95), (x + s * 0.1, y - s * 0.72), (x - s * 0.3, y - s * 0.45)], fill=(220, 208, 180), outline=I)
    elif kind == 'crane':
        d.line([(x - s * 0.2, y + s * 0.6), (x - s * 0.2, y - s)], fill=(196, 150, 40), width=3)
        d.line([(x - s * 0.7, y - s), (x + s, y - s)], fill=(196, 150, 40), width=3)
        d.line([(x + s * 0.8, y - s), (x + s * 0.8, y - s * 0.3)], fill=I, width=1)
    elif kind == 'ruin':
        for ox, hh in ((-0.7, 0.9), (-0.25, 0.5), (0.2, 1.1), (0.65, 0.4)):
            d.rectangle([x + ox * s, y + s * 0.5 - hh * s, x + ox * s + s * 0.28, y + s * 0.5], fill=(190, 182, 166), outline=I, width=1)
    elif kind == 'arena':
        d.ellipse([x - s * 1.2, y - s * 0.7, x + s * 1.2, y + s * 0.7], fill=(214, 200, 170), outline=I, width=lw + 1)
        d.ellipse([x - s * 0.78, y - s * 0.42, x + s * 0.78, y + s * 0.42], fill=(222, 196, 140), outline=I, width=lw)
        for k in range(18):
            a = k / 18 * 2 * math.pi
            d.line([(x + s * 0.82 * math.cos(a), y + s * 0.46 * math.sin(a)), (x + s * 1.15 * math.cos(a), y + s * 0.67 * math.sin(a))], fill=I)
    elif kind == 'arch':
        d.polygon([(x - s, y + s * 0.6), (x - s * 0.8, y - s * 0.6), (x + s * 0.8, y - s * 0.6), (x + s, y + s * 0.6), (x + s * 0.5, y + s * 0.6),
                   (x + s * 0.45, y - s * 0.1), (x - s * 0.45, y - s * 0.1), (x - s * 0.5, y + s * 0.6)], fill=(200, 140, 96), outline=I, width=lw)
    elif kind == 'cabin':
        house_glyph(d, x, y, s * 0.6, (130, 80, 52))
    elif kind == 'yurts':
        for ox, oy in ((-0.6, 0.2), (0.5, 0.0), (0, 0.55), (0.9, 0.6)):
            px, py, r = x + ox * s, y + oy * s, s * 0.32
            d.pieslice([px - r, py - r, px + r, py + r], 180, 360, fill=(236, 226, 206), outline=I, width=1)
            d.line([(px - r, py), (px + r, py)], fill=I, width=1)
    elif kind == 'greattree':
        d.rectangle([x - s * 0.12, y - s * 0.2, x + s * 0.12, y + s * 0.6], fill=(110, 80, 52), outline=I)
        for ox, oy, r in ((0, -0.7, 0.55), (-0.45, -0.35, 0.42), (0.45, -0.35, 0.42), (0, -0.25, 0.4)):
            d.ellipse([x + (ox - r) * s, y + (oy - r) * s, x + (ox + r) * s, y + (oy + r) * s], fill=(92, 140, 74), outline=(50, 76, 40), width=1)
    elif kind == 'titan':
        d.ellipse([x - s * 0.6, y - s * 0.6, x + s * 0.6, y + s * 0.5], fill=(214, 200, 170), outline=I, width=lw)
        d.ellipse([x - s * 0.35, y - s * 0.3, x - s * 0.1, y - s * 0.05], fill=(60, 40, 30))
        d.ellipse([x + s * 0.1, y - s * 0.3, x + s * 0.35, y - s * 0.05], fill=(60, 40, 30))
        for k in range(-2, 3):
            d.line([(x + k * s * 0.4, y + s * 0.3), (x + k * s * 0.5, y + s * 0.9)], fill=(176, 164, 140), width=2)
    elif kind == 'crystal':
        for ox, hh, col in ((-0.4, 1.0, (150, 120, 214)), (0.35, 1.3, (100, 196, 210)), (0, 1.8, (196, 140, 220))):
            px = x + ox * s
            pts = [(px, y + s * 0.5 - hh * s), (px + s * 0.22, y + s * 0.5 - hh * s * 0.6), (px + s * 0.18, y + s * 0.5), (px - s * 0.18, y + s * 0.5), (px - s * 0.22, y + s * 0.5 - hh * s * 0.6)]
            d.polygon(pts, fill=col, outline=I)
    elif kind == 'henge':
        for k in range(10):
            a = k / 10 * 2 * math.pi
            px, py = x + s * 0.8 * math.cos(a), y + s * 0.45 * math.sin(a)
            d.rectangle([px - 2, py - 6, px + 2, py + 1], fill=(170, 164, 156), outline=I)
    elif kind == 'beacon':
        d.ellipse([x - s * 0.9, y - s * 1.9, x + s * 0.9, y - s * 0.1], fill=(150, 220, 230, 60))
        d.rectangle([x - s * 0.12, y - s * 1.3, x + s * 0.12, y + s * 0.5], fill=(200, 206, 210), outline=I)
        d.ellipse([x - s * 0.28, y - s * 1.5, x + s * 0.28, y - s * 0.95], fill=(170, 236, 240), outline=I)
    elif kind == 'cube':
        a = s * 0.6
        d.polygon([(x, y - a), (x + a, y - a * 0.5), (x, y), (x - a, y - a * 0.5)], fill=(226, 226, 222), outline=I)
        d.polygon([(x - a, y - a * 0.5), (x, y), (x, y + a), (x - a, y + a * 0.5)], fill=(180, 180, 176), outline=I)
        d.polygon([(x + a, y - a * 0.5), (x, y), (x, y + a), (x + a, y + a * 0.5)], fill=(140, 140, 138), outline=I)


def star(d, x, y, R, r, n, fill, outline, rot=0.0):
    pts = []
    for k in range(2 * n):
        a = rot - math.pi / 2 + k * math.pi / n
        rad = R if k % 2 == 0 else r
        pts.append((x + rad * math.cos(a), y + rad * math.sin(a)))
    d.polygon(pts, fill=fill, outline=outline, width=2)
    for k in range(0, 2 * n, 2):
        a = rot - math.pi / 2 + k * math.pi / n
        d.polygon([(x, y), (x + R * math.cos(a), y + R * math.sin(a)), (x + r * math.cos(a + math.pi / n), y + r * math.sin(a + math.pi / n))], fill=shade_col(fill, 0.78))


def bezier(p0, p1, p2, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
            for t in (k / n for k in range(n + 1))]


def cubic(p0, p1, p2, p3, n=24):
    out = []
    for k in range(n + 1):
        t = k / n
        a, b, c, e = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]))
    return out


def dashed(d, pts, fill, width=2, on=5, off=4):
    acc, draw_on = 0.0, True
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        t = 0.0
        while t < seg:
            step = min((on if draw_on else off) - acc, seg - t)
            if draw_on:
                a, b = t / seg, (t + step) / seg
                d.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=fill, width=width)
            t += step
            acc += step
            if acc >= (on if draw_on else off) - 1e-6:
                acc, draw_on = 0.0, not draw_on


# ---------------------------------------------------------------- layout

def place_shards(rng):
    """Ranks fill the rings from the centre out; within a ring, avoid repeating a neighbour's biome."""
    by_ring = {r: [] for r in range(5)}
    for j in range(N):
        for i in range(N):
            by_ring[ring_of(i, j)].append((i, j))
    placed = {}
    start = 0
    for r in range(5):
        ring_cells = sorted(by_ring[r], key=lambda ij: math.atan2(ij[1] - 4.5, ij[0] - 4.5))
        pool = list(range(start, start + len(ring_cells)))
        start += len(ring_cells)
        rng.shuffle(pool)
        for (i, j) in ring_cells:
            nb = {SHARDS[placed[n]][1] for n in ((i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1)) if n in placed}
            pick = next((k for k in pool if SHARDS[k][1] not in nb), pool[0])
            pool.remove(pick)
            placed[(i, j)] = pick
    return placed


def cell_xy(i, j):
    return GX0 + i * P, GY0 + j * P


def lattice_x(k):
    return GX0 + k * P - G / 2


# ---------------------------------------------------------------- the world fields

def build_world(rng, allcells):
    """Each shard writes only its own plot. The gap between plots is server ground: a verge that fades each shard's
    edge colour to the verge and its edge height down to the Boulevard's grade; water stops at the plot edge."""
    F = {'h': np.full((FN, FN), ROAD_H, np.float32), 'wet': np.full((FN, FN), 0.3, np.float32),
         'cloud': np.zeros((FN, FN), np.float32), 'lava': np.zeros((FN, FN), np.float32)}
    col = np.broadcast_to(np.array(VERGE, np.float32), (FN, FN, 3)).copy()
    wcol = np.broadcast_to(np.array(SEA_SHALLOW, np.float32), (FN, FN, 3)).copy()
    dens = {k: np.zeros((FN, FN), np.float32) for k in TREE_KINDS}
    cells = {}
    ins = slice(WM, WM + CH)
    for (i, j), k in allcells.items():
        win = Win(np.random.default_rng(SEED * 1000 + k))
        BIOMES[SHARDS[k][1]](win)
        fx0, fy0 = (i + 1) * (P // FS), (j + 1) * (P // FS)
        sl = (slice(fy0, fy0 + CH), slice(fx0, fx0 + CH))
        F['h'][sl] = win.h[ins, ins]
        wet_ = win.wet if np.ndim(win.wet) else np.full((WN, WN), win.wet, np.float32)
        F['wet'][sl] = wet_[ins, ins]
        F['cloud'][sl] = win.cloud
        if win.lava is not None:
            F['lava'][sl] = win.lava[ins, ins]
        col[sl] = win.col[ins, ins]
        if win.wcol is not None:
            wcol[sl] = win.wcol[ins, ins]
        for kind, arr in win.dens.items():
            dens[kind][sl] = arr[ins, ins]
        win.origin = (fx0, fy0)
        cells[(i, j)] = win
    g2 = G // FS // 2
    verge = np.array(VERGE, np.float32)
    for win in cells.values():
        fx0, fy0 = win.origin
        ys = np.arange(fy0 - g2, fy0 + CH + g2)
        xs = np.arange(fx0 - g2, fx0 + CH + g2)
        ys = ys[(ys >= 0) & (ys < FN)]
        xs = xs[(xs >= 0) & (xs < FN)]
        cy_, cx_ = np.clip(ys, fy0, fy0 + CH - 1), np.clip(xs, fx0, fx0 + CH - 1)
        dist = np.hypot((ys - cy_)[:, None], (xs - cx_)[None, :]).astype(np.float32)
        out = dist > 0
        src, dst = np.ix_(cy_, cx_), np.ix_(ys, xs)
        t = smooth(0, 7.5, dist)
        eh = F['h'][src]
        F['h'][dst] = np.where(out, eh * (1 - t) + ROAD_H * t, eh)
        F['wet'][dst] = np.where(out, 0.3, F['wet'][src])
        F['cloud'][dst] = np.where(out, 0.0, F['cloud'][src])
        F['lava'][dst] = np.where(out, F['lava'][src] * (1 - smooth(0, 2, dist)), F['lava'][src])
        tc = smooth(0, 6, dist)[..., None]
        ec = col[src]
        col[dst] = np.where(out[..., None], ec * (1 - tc) + verge * tc, ec)
        for kind in dens:
            dens[kind][dst] = np.where(out, 0.0, dens[kind][src])
    F['col'], F['wcol'], F['dens'] = col, wcol, dens
    return F, cells


def lattice_y(k):
    return GY0 + k * P - G / 2


def highway(allcells):
    """The Boulevard runs along every plot that exists; where content stops it breaks off over the void."""
    segs, ends = [], {}

    def add(a, b, pa, pb, d_):
        segs.append((a, b))
        ends.setdefault(pa, []).append(d_)
        ends.setdefault(pb, []).append((-d_[0], -d_[1]))
    for k in range(-1, N + 2):
        for j in range(-1, N + 1):
            if (k - 1, j) in allcells or (k, j) in allcells:
                add((lattice_x(k), lattice_y(j)), (lattice_x(k), lattice_y(j + 1)), (k, j), (k, j + 1), (0, 1))
    for l in range(-1, N + 2):
        for i in range(-1, N + 1):
            if (i, l - 1) in allcells or (i, l) in allcells:
                add((lattice_x(i), lattice_y(l)), (lattice_x(i + 1), lattice_y(l)), (i, l), (i + 1, l), (1, 0))
    stubs = []
    for pt, dirs in ends.items():
        for dx_, dy_ in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            if (-dx_, -dy_) in dirs and (dx_, dy_) not in dirs:
                x, y = lattice_x(pt[0]), lattice_y(pt[1])
                stubs.append(((x, y), (x + dx_ * 150, y + dy_ * 150), (dx_, dy_)))
    return segs, ends, stubs


def edge_marks(d, cells, F):
    """Where an author's plot meets the server verge: sea walls on water, a rim on cloud drops, hachures on cliffs."""
    h, wet, cloud = F['h'], F['wet'], F['cloud']
    for (i, j), win in cells.items():
        fx0, fy0 = win.origin
        x0, y0 = GX0 + i * P, GY0 + j * P
        for side in range(4):
            prev = None
            for sx in range(0, C + 1, 4):
                sf = min(CH - 1, sx // FS)
                fx, fy, px, py, nx, ny = [(fx0 + sf, fy0, x0 + sx, y0, 0, -1), (fx0 + sf, fy0 + CH - 1, x0 + sx, y0 + C, 0, 1),
                                          (fx0, fy0 + sf, x0, y0 + sx, -1, 0), (fx0 + CH - 1, fy0 + sf, x0 + C, y0 + sx, 1, 0)][side]
                if not (0 <= fx < FN and 0 <= fy < FN):
                    prev = None
                    continue
                wv, cv, hv = wet[fy, fx], cloud[fy, fx], h[fy, fx]
                kind = 'cloud' if (wv < 0 and cv > 0.5) else 'water' if wv < -0.004 else 'cliff' if hv - ROAD_H > 0.13 else None
                if kind == 'water' and prev and prev[0] == 'water':
                    d.line([prev[1], (px, py)], fill=(118, 110, 100), width=6)
                    d.line([prev[1], (px, py)], fill=(224, 216, 200), width=3)
                elif kind == 'cloud' and prev and prev[0] == 'cloud':
                    d.line([prev[1], (px, py)], fill=(96, 74, 58), width=4)
                elif kind == 'cliff':
                    ln = min(16, 5 + 36 * (hv - ROAD_H - 0.13))
                    d.line([(px, py), (px + nx * ln, py + ny * ln)], fill=(98, 74, 56, 210), width=2)
                prev = (kind, (px, py))


def space(rng):
    """The void the world floats in: night ink, a little nebula, stars."""
    neb = up(rng.random((40, 34)), WS, HS) * 0.6 + up(rng.random((160, 134)), WS, HS) * 0.4
    base = mix((16, 20, 38), (34, 34, 64), smooth(0.45, 0.85, neb))
    base = mix(base, (64, 46, 88), smooth(0.72, 0.95, neb) * 0.5)
    n = int(4200 * SCALE * SCALE)
    ys = rng.integers(0, HS, n)
    xs = rng.integers(0, WS, n)
    b = rng.random(n) ** 3
    star = np.array([244, 236, 210], np.float32)
    sz = max(1, int(round(SCALE)))
    for dy, dx, k in [(a, b, 1.0) for a in range(sz) for b in range(sz)] + [(0, sz, 0.4), (sz, 0, 0.4)]:
        yy, xx = np.clip(ys + dy, 0, HS - 1), np.clip(xs + dx, 0, WS - 1)
        base[yy, xx] = base[yy, xx] * (1 - b[:, None] * k) + star * b[:, None] * k
    return base


def plate_mask(allcells):
    m = np.zeros((HS, WS), bool)
    fx1, fy1 = FX0 + FN * FS, FY0 + FN * FS
    for (i, j) in allcells:
        x0, y0 = cell_xy(i, j)
        a, b = max(FX0, x0 - G), min(fx1, x0 + C + G)
        c, e = max(FY0, y0 - G), min(fy1, y0 + C + G)
        m[int(c * SCALE):int(e * SCALE), int(a * SCALE):int(b * SCALE)] = True
    return m


def plate_rim(arr, m):
    """The plate's thickness shows below its rim, layered like the cut earth it is, with a faint glow on the void."""
    face = np.zeros(m.shape, np.int16)
    depth = int(26 * SCALE)
    for k in range(1, depth + 1):
        sh = np.zeros_like(m)
        sh[k:] = m[:-k]
        new = sh & ~m & (face == 0)
        face[new] = k
    f = face > 0
    t = (face[f] / float(depth))[:, None]
    strata = ((face[f] % max(1, int(7 * SCALE))) < max(1, int(SCALE)))[:, None]
    col = np.array([150, 116, 84], np.float32) * (1 - t) + np.array([70, 52, 40], np.float32) * t
    col = np.where(strata, col * 0.8, col)
    arr[f] = col
    st = int(8 * SCALE)
    small = m[::st, ::st].astype(np.float32)
    glow = up(blur(small, 6), WS, HS)
    arr[:] = mix(arr, (90, 100, 150), (glow * 0.35 * (~m & ~f))[..., None] * np.ones(3, np.float32))
    return arr


# ---------------------------------------------------------------- render

def main():
    rng = np.random.default_rng(SEED)
    placed = place_shards(rng)
    # a ragged fringe of server placeholder plots; past them the world just stops
    allcells = dict(placed)
    prng = np.random.default_rng(SEED + 77)
    for j in range(-1, N):
        for i in range(-1, N + 1):
            if (0 <= i < N and 0 <= j < N) or prng.random() > 0.55:
                continue
            allcells[(i, j)] = len(SHARDS)
            SHARDS.append(('placeholder', 'placeholder', 'beacon', '', 'placeholder'))
    F, cells = build_world(rng, allcells)
    h, wet, cloud = F['h'], F['wet'], F['cloud']
    xs = np.arange(FN, dtype=np.float32) * FS + FX0
    ys = np.arange(FN, dtype=np.float32) * FS + FY0
    X, Y = np.meshgrid(xs, ys)

    EXT = int(FN * FS * SCALE)

    def U(a):
        return up(a, EXT, EXT)
    Hf, WETf, CLf, LAVf = U(h), U(wet), U(cloud), U(F['lava'])
    COLf = np.stack([U(F['col'][..., k]) for k in range(3)], -1)
    WCf = np.stack([U(F['wcol'][..., k]) for k in range(3)], -1)
    land = smooth(-0.004, 0.004, WETf)

    gy, gx = np.gradient(Hf * 330 * SCALE)
    lx, ly, lz = -0.62, -0.62, 0.48
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    s = (-gx * lx - gy * ly + lz) / (np.sqrt(gx * gx + gy * gy + 1) * ln) - lz / ln
    s = np.clip(s, -0.5, 0.32)
    lcol = COLf * (1 + 0.8 * s)[..., None]
    lcol = mix(lcol, (250, 246, 236), np.clip(Hf - 0.75, 0, 1) * 0.3)
    tint = np.zeros_like(Hf)
    for kind in ('green', 'jungle', 'pine', 'willow', 'autumn'):
        tint = np.maximum(tint, U(blur(F['dens'][kind], 2)))
    lcol *= (1 - 0.14 * tint)[..., None]
    glow = U(blur(F['lava'], 4))
    lcol = mix(lcol, (226, 108, 44), np.clip(glow * 1.6, 0, 0.55))
    lcol = mix(lcol, (250, 172, 72), np.clip(LAVf * 1.2, 0, 1))

    depth = np.clip(-WETf, 0, None)
    water = mix(WCf, SEA_DEEP, smooth(0.0, 0.28, depth) * 0.75)
    for lev, a in ((0.02, 0.3), (0.05, 0.22), (0.1, 0.14)):
        water = mix(water, (82, 114, 138), contour(-WETf, lev, 0.9 * SCALE) * a)
    cl = up(fbm(rng, FN // 2, 12, 5), EXT, EXT)
    clouds = mix((206, 216, 228), (248, 250, 252), smooth(0.3, 0.8, cl))
    clouds = mix(clouds, (178, 194, 210), np.clip(sum(contour(cl, lv, 0.7 * SCALE) for lv in (0.45, 0.62, 0.78)), 0, 1) * 0.45)
    isle_shadow = np.roll(np.roll(land, int(16 * SCALE), 0), int(10 * SCALE), 1)
    st = int(FS * SCALE)
    clouds = mix(clouds, (150, 160, 182), up(blur(isle_shadow[::st, ::st], 4), EXT, EXT) * 0.5)
    under = mix(water, clouds, smooth(0.35, 0.65, CLf))
    cliff = np.clip(np.roll(land, int(8 * SCALE), 0) - land, 0, 1) * smooth(0.35, 0.65, CLf)
    under = mix(under, (128, 100, 76), cliff)
    rgb = mix(under, lcol, land)
    coast = contour(WETf, 0.0, 1.1 * SCALE) * (1 - smooth(0.4, 0.7, CLf) * 0.6)
    rgb = mix(rgb, (70, 60, 50), coast * 0.8)
    rgb = rgb * 0.88 + np.array(PAPER, np.float32) * 0.12
    rr = np.hypot(X - HEART[0], Y - HEART[1])
    rgb = mix(rgb, (255, 214, 130), U(np.exp(-(rr / 1100) ** 2)) * 0.12)
    ringd = U(np.maximum(np.abs(X - HEART[0]), np.abs(Y - HEART[1])) / P)
    age = smooth(2.6, 5.0, ringd) * 0.24
    grey = rgb.mean(-1, keepdims=True)
    rgb = mix(rgb, grey * 0.5 + np.array(PAPER) * 0.5, age)

    # the world is a flat plate adrift in the void
    canvas_arr = space(rng)
    plate = plate_mask(allcells)
    canvas_arr = plate_rim(canvas_arr, plate)
    oy, ox = int(FY0 * SCALE), int(FX0 * SCALE)
    sub = plate[oy:oy + EXT, ox:ox + EXT]
    region = canvas_arr[oy:oy + EXT, ox:ox + EXT]
    region[sub] = rgb[:sub.shape[0], :sub.shape[1]][sub]
    canvas = Image.fromarray(np.clip(canvas_arr, 0, 255).astype(np.uint8), 'RGB')
    d = SDraw(canvas)
    edge_marks(d, cells, F)

    clear = Image.new('L', (FN, FN), 0)
    cdraw = ImageDraw.Draw(clear)

    def to_f(x, y):
        return ((x - FX0) / FS, (y - FY0) / FS)
    segs, joints, stubs = highway(allcells)
    for a, b in segs:
        cdraw.line([to_f(*a), to_f(*b)], fill=255, width=16)

    # the grid's contract: an on- and off-ramp at the middle of every shard edge. Past the ramps, the shard's own design.
    ramps, inner, ends, hubs = [], [], [], []
    for (i, j), k in allcells.items():
        win = cells[(i, j)]
        x0, y0 = cell_xy(i, j)
        r = ring_of(i, j)

        def xy(u, v, x0=x0, y0=y0):
            return (x0 + u * C, y0 + v * C)
        rngh = np.random.default_rng(SEED * 3 + k)
        if win.hub == (0.5, 0.45):
            win.hub = (0.5 + rngh.uniform(-0.16, 0.16), 0.45 + rngh.uniform(-0.14, 0.16))
        hx, hy = xy(*win.hub)
        win.hamlet = None
        hubs.append((i, j, k, hx, hy, win, xy))
        style = ROAD_STYLE.get(SHARDS[k][1], 'none')
        rngc = np.random.default_rng(SEED + k)
        heads = []
        for (bu, bv), (nu, nv) in (((0.5, -G / 2 / C), (0, 1)), ((0.5, 1 + G / 2 / C), (0, -1)),
                                   ((-G / 2 / C, 0.5), (1, 0)), ((1 + G / 2 / C, 0.5), (-1, 0))):
            bx, by = xy(bu, bv)
            tux, tuy = abs(nv), abs(nu)
            sx, sy = bx + nu * (G / 2 + 6.4), by + nv * (G / 2 + 6.4)
            ramps.append(([(bx, by), (sx, sy)], r))
            cdraw.line([to_f(bx, by), to_f(sx, sy)], fill=255, width=2)
            heads.append(((sx, sy), (nu, nv)))

        def onto(p, n, dist, jit):
            return (p[0] + n[0] * dist + n[1] * jit, p[1] + n[1] * dist + n[0] * jit)
        used = set()
        if style in ('through', 'old'):
            pairs = [(0, 1), (2, 3)]
            rngc.shuffle(pairs)
            for q, (a_, b_) in enumerate(pairs[:2 if rngc.random() < 0.25 else 1]):
                (pa, na), (pb, nb) = heads[a_], heads[b_]
                pts = cubic(pa, onto(pa, na, C * 0.38, rngc.uniform(-0.3, 0.3) * C), onto(pb, nb, C * 0.38, rngc.uniform(-0.3, 0.3) * C), pb, 40)
                inner.append((pts, 'road' if style == 'through' else 'oldroad', r))
                cdraw.line([to_f(*p) for p in pts], fill=255, width=7)
                used.update((a_, b_))
                if q == 0 and style == 'through':
                    win.hamlet = (pts, int(len(pts) * rngc.uniform(0.3, 0.7)))
        elif style == 'trail':
            near = min(range(4), key=lambda q: math.hypot(heads[q][0][0] - hx, heads[q][0][1] - hy))
            pa, na = heads[near]
            pts = cubic(pa, onto(pa, na, C * 0.2, rngc.uniform(-0.15, 0.15) * C), (hx + rngc.uniform(-30, 30), hy + 30), (hx, hy + 12), 30)
            inner.append((pts, 'trail', r))
        elif style == 'city':
            cu, cv = win.city_c
            ccx, ccy = xy(cu, cv)
            R = win.city_r * C
            for q, ((pa, na)) in enumerate(heads):
                ang = math.atan2(pa[1] - ccy, pa[0] - ccx)
                gate = (ccx + R * math.cos(ang), ccy + R * math.sin(ang))
                pts = cubic(pa, onto(pa, na, 12, 0), (gate[0] + (pa[0] - gate[0]) * 0.3, gate[1] + (pa[1] - gate[1]) * 0.3), gate, 12)
                inner.append((pts, 'road', r))
                ends.append((gate, 'citygate', r))
                used.add(q)
        elif style == 'landing':
            isles = []
            for _ in range(40):
                qx, qy = xy(rngc.uniform(0.1, 0.9), rngc.uniform(0.1, 0.9))
                wv = sample(wet, qx, qy)
                if wv is not None and wv > 0.05 and math.hypot(qx - hx, qy - hy) > 50:
                    isles.append((qx, qy))
            for q in range(min(3, len(isles))):
                inner.append(([(hx, hy), isles[q]], 'rope', r))
        elif style == 'rainbow':
            (pa, na), (pb, nb) = heads[2], heads[3]
            pts = []
            for q in range(121):
                t = q / 120
                pts.append((pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t + 70 * math.sin(t * math.pi * 3) * math.sin(t * math.pi)))
            inner.append((pts, 'rainbow', r))
            used.update((2, 3))
        elif style == 'serpent':
            pa, na = heads[2]
            L = math.hypot(hx - pa[0], hy - pa[1]) + 1e-6
            px_, py_ = -(hy - pa[1]) / L, (hx - pa[0]) / L
            pts = []
            for q in range(97):
                t = q / 96
                o = 30 * math.sin(t * math.pi * 6) * math.sin(t * math.pi)
                pts.append((pa[0] + (hx - pa[0]) * t + px_ * o, pa[1] + (hy - pa[1]) * t + py_ * o))
            inner.append((pts, 'serpent', r))
            used.add(2)
        for q, (pa, na) in enumerate(heads):
            if q in used:
                continue
            wv = sample(wet, pa[0], pa[1])
            cv = sample(cloud, pa[0], pa[1])
            if wv is not None and wv < -0.004:
                kind = 'platform' if cv is not None and cv > 0.5 else 'pier'
            else:
                kind = 'turn'
            ends.append(((pa, na), kind, r))
            if kind == 'pier' and style == 'dock' and q == 0:
                inner.append(([onto(pa, na, 16, 0), (hx, hy)], 'ferry', r))
        cdraw.ellipse([*to_f(hx - 26, hy - 26), *to_f(hx + 26, hy + 26)], fill=255)
        if win.hamlet:
            pts, at = win.hamlet
            cdraw.ellipse([*to_f(pts[at][0] - 34, pts[at][1] - 34), *to_f(pts[at][0] + 34, pts[at][1] + 34)], fill=255)
    clear_arr = blur(np.asarray(clear).astype(np.float32) / 255, 1)

    # trees and peaks over the whole world, top to bottom
    glyphs = []
    landf = smooth(0.01, 0.04, wet) * (1 - smooth(0.4, 0.6, cloud) * (wet < 0.02))
    for kind, (glyph, cols, step, (r0, r1)) in TREE_KINDS.items():
        dm = F['dens'][kind] * landf * (1 - clear_arr)
        if dm.max() < 0.02:
            continue
        ys_, xs_ = np.mgrid[0:FN * FS:step, 0:FN * FS:step].astype(np.float32)
        xs_ += rng.uniform(-0.5, 0.5, xs_.shape) * step
        ys_ += rng.uniform(-0.5, 0.5, ys_.shape) * step
        fx = np.clip((xs_ / FS).astype(int), 0, FN - 1)
        fy = np.clip((ys_ / FS).astype(int), 0, FN - 1)
        keep = rng.random(xs_.shape) < dm[fy, fx]
        for px, py in zip(xs_[keep].tolist(), ys_[keep].tolist()):
            glyphs.append((py + FY0, px + FX0, glyph, rng.uniform(r0, r1), cols[rng.integers(len(cols))]))
    pk = (h > 0.64) * (wet > 0.05) * (1 - clear_arr) * 0.5
    ys_, xs_ = np.mgrid[0:FN * FS:22, 0:FN * FS:22].astype(np.float32)
    xs_ += rng.uniform(-8, 8, xs_.shape)
    ys_ += rng.uniform(-8, 8, ys_.shape)
    fx = np.clip((xs_ / FS).astype(int), 0, FN - 1)
    fy = np.clip((ys_ / FS).astype(int), 0, FN - 1)
    keep = rng.random(xs_.shape) < pk[fy, fx]
    for px, py in zip(xs_[keep].tolist(), ys_[keep].tolist()):
        hv = h[int(py / FS), int(px / FS)]
        glyphs.append((py + FY0, px + FX0, 'peak', 8 + 16 * (hv - 0.64) / 0.36, None))
    glyphs.sort(key=lambda g: g[0])
    for py, px, kind, r, col in glyphs:
        if kind == 'peak':
            peak_glyph(d, px, py, r)
        else:
            tree_glyph(d, px, py, kind, r, col)

    # entries first, so the boulevard's deck runs over where they join it
    for pts, r in ramps:
        d.line(pts, fill=(104, 70, 52), width=4)
        d.line(pts, fill=(240, 230, 204), width=2)

    # the boulevard
    draw_highway(d, segs, stubs)

    # past the ramps: each shard's own roads, trails, piers and landings
    for pts, kind, r in inner:
        if kind == 'road':
            wdt = [4, 3, 3, 3, 2][r]
            d.line(pts, fill=(104, 70, 52), width=wdt + 3, joint='curve')
            d.line(pts, fill=(236, 226, 200), width=wdt, joint='curve')
        elif kind == 'oldroad':
            dashed(d, pts, (130, 116, 100), 4, 7, 5)
        elif kind == 'trail':
            dashed(d, pts, (120, 74, 52), 2, 5, 4)
        elif kind == 'ferry':
            dashed(d, pts, (60, 90, 120), 2, 8, 6)
        elif kind == 'rope':
            dashed(d, pts, (120, 92, 66), 2, 3, 3)
        elif kind == 'rainbow':
            d.line([(x_ + 10, y_ + 16) for x_, y_ in pts], fill=(60, 70, 96, 50), width=12, joint='curve')
            for wd, col in ((13, (210, 60, 60)), (11, (236, 140, 50)), (9, (240, 210, 70)), (7, (90, 180, 90)), (5, (70, 130, 210)), (3, (140, 90, 190))):
                d.line(pts, fill=col, width=wd, joint='curve')
        elif kind == 'serpent':
            d.line([(x_ + 10, y_ + 14) for x_, y_ in pts], fill=(60, 70, 96, 50), width=6, joint='curve')
            d.line(pts, fill=(120, 84, 40), width=7, joint='curve')
            d.line(pts, fill=(232, 190, 100), width=4, joint='curve')
    for spec, kind, r in ends:
        if kind == 'citygate':
            gx_, gy_ = spec
            d.rectangle([gx_ - 5, gy_ - 5, gx_ + 5, gy_ + 5], fill=(214, 204, 186), outline=INK, width=2)
            continue
        (px, py), (nu, nv) = spec
        if kind == 'turn':
            d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(240, 230, 204), outline=(104, 70, 52), width=1)
        elif kind == 'pier':
            ex, ey = px + nu * 10, py + nv * 10
            d.line([(px, py), (ex, ey)], fill=(110, 80, 56), width=5)
            d.line([(px, py), (ex, ey)], fill=(196, 160, 112), width=3)
            d.polygon([(ex + nv * 8, ey + nu * 8), (ex + nv * 8 + nu * 9, ey + nu * 8 + nv * 9), (ex + nv * 4 + nu * 11, ey + nu * 4 + nv * 11)], fill=(150, 100, 64), outline=INK)
        elif kind == 'platform':
            d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=(226, 216, 196), outline=INK, width=1)
            d.ellipse([px - 2, py - 2, px + 2, py + 2], outline=(176, 80, 56), width=1)
    for i, j, k, hx, hy, win, xy in hubs:
        r = ring_of(i, j)
        rngc = np.random.default_rng(SEED * 7 + k)
        for f in win.feats:
            f(d, xy)
        if getattr(win, 'lanterns', False) and r <= 2:
            for _ in range(46):
                a, rr2 = rngc.uniform(0, 2 * math.pi), rngc.uniform(0.07, 0.27) * C
                qx, qy = hx + rr2 * math.cos(a), hy + rr2 * math.sin(a)
                wv = sample(wet, qx, qy)
                if wv is not None and wv < -0.01:
                    d.ellipse([qx - 4, qy - 4, qx + 4, qy + 4], fill=(255, 200, 90, 70))
                    d.ellipse([qx - 1.5, qy - 1.5, qx + 1.5, qy + 1.5], fill=(255, 214, 110))
        # a hamlet where a through road wants one, bigger where more people play
        if win.hamlet:
            pts, at = win.hamlet
            count = [26, 20, 14, 9, 5][r]
            ruined = '(abandoned)' in SHARDS[k][0]
            for _ in range(count):
                q = int(np.clip(at + rngc.integers(-6, 7), 1, len(pts) - 2))
                (ax_, ay_), (bx_, by_) = pts[q - 1], pts[q + 1]
                tl = math.hypot(bx_ - ax_, by_ - ay_) + 1e-6
                side = rngc.choice([-1, 1]) * rngc.uniform(7, 16)
                qx, qy = pts[q][0] - (by_ - ay_) / tl * side, pts[q][1] + (bx_ - ax_) / tl * side
                wv = sample(wet, qx, qy)
                if wv is None or wv < 0.03:
                    continue
                roof = (150, 144, 136) if ruined else [(176, 92, 66), (160, 80, 60), (184, 112, 76)][rngc.integers(3)]
                house_glyph(d, qx, qy, 3.2, roof)
        if SHARDS[k][2]:
            s = [17, 14, 12, 10, 9][r]
            icon(d, SHARDS[k][2], hx, hy, s, win.__dict__.get('city') == 'neon')
        if hasattr(win, 'peak'):
            px, py = xy(*win.peak)
            peak_glyph(d, px, py - 4, 22, smoke=True)

    draw_junctions(d, joints)
    draw_labels(d, allcells, cells)
    ring_labels(d)
    furniture(canvas)
    canvas = finish(canvas, rng)
    canvas.save(OUT)
    print('wrote', OUT, canvas.size, len(glyphs), 'glyphs', len(allcells) - 100, 'placeholders')


def paper(rng):
    n = up(rng.random((60, 50)), W, H) * 0.6 + up(rng.random((240, 200)), W, H) * 0.4
    return np.array(PAPER, np.float32) * (0.94 + 0.08 * n)[..., None]


def draw_highway(d, segs, stubs):
    """The grid's own road: a dual carriageway on server ground along every plot, broken off over the void."""
    deck = 12
    for a, b in segs:
        d.line([(a[0] + 2, a[1] + 3), (b[0] + 2, b[1] + 3)], fill=(60, 44, 30, 60), width=deck + 10)
        d.line([a, b], fill=(186, 176, 146, 150), width=deck + 8)
        d.line([a, b], fill=(98, 68, 50), width=deck + 3)
        d.line([a, b], fill=(240, 232, 208), width=deck - 1)
    for (ax, ay), (bx, by) in segs:
        dashed(d, [(ax, ay), (bx, by)], (166, 66, 48), 1, 8, 5)
        vertical = ax == bx
        nx, ny = (1, 0) if vertical else (0, 1)
        length = abs(by - ay) if vertical else abs(bx - ax)
        for t in np.arange(10, length, 26):
            px, py = (ax, ay + t) if vertical else (ax + t, ay)
            g = math.exp(-(math.hypot(px - HEART[0], py - HEART[1]) / 1500) ** 2)
            if g < 0.12:
                continue
            for sgn in (-1, 1):
                qx, qy = px + sgn * nx * (deck / 2 + 5), py + sgn * ny * (deck / 2 + 5)
                d.ellipse([qx - 4, qy - 4, qx + 4, qy + 4], fill=(255, 214, 120, int(90 * g)))
                d.ellipse([qx - 1.3, qy - 1.3, qx + 1.3, qy + 1.3], fill=(255, 230, 150))
    # where the uploads stop, the Boulevard runs on a little way on piers into the void and ends at a barrier
    for (ax, ay), (bx, by), (dx, dy) in stubs:
        nx, ny = abs(dy), abs(dx)
        for t in range(14, 140, 18):
            px, py = ax + dx * t, ay + dy * t
            d.line([(px, py), (px + 6, py + 30)], fill=(110, 100, 110, 120), width=3)
        d.line([(ax, ay), (bx, by)], fill=(150, 124, 100), width=deck + 3)
        d.line([(ax, ay), (bx, by)], fill=(226, 216, 196), width=deck)
        ex, ey = bx, by
        for q in range(-3, 3):
            col = (196, 52, 44) if q % 2 else (244, 240, 230)
            d.line([(ex + nx * q * 4, ey + ny * q * 4), (ex + nx * (q + 1) * 4, ey + ny * (q + 1) * 4)], fill=col, width=5)


def draw_junctions(d, joints):
    """An interchange with a light column wherever three or four roads meet, a light column at the corners,
    the grand cloverleaf at the Heart."""
    for (a, b), dirs in joints.items():
        x, y = lattice_x(a), lattice_y(b)
        if (x, y) == HEART:
            continue
        g = math.exp(-(math.hypot(x - HEART[0], y - HEART[1]) / 1600) ** 2)
        if len(dirs) >= 3:
            R = 13 + 5 * g
            d.ellipse([x - R - 3, y - R - 3, x + R + 3, y + R + 3], fill=(60, 44, 30, 50))
            d.ellipse([x - R, y - R, x + R, y + R], fill=(240, 232, 208), outline=(98, 68, 50), width=3)
            d.ellipse([x - R * 0.5, y - R * 0.5, x + R * 0.5, y + R * 0.5], fill=(150, 170, 110), outline=(98, 68, 50), width=2)
            d.ellipse([x - R * 1.9, y - R * 1.9, x + R * 1.9, y + R * 1.9], fill=(255, 236, 170, int(30 + 60 * g)))
        d.ellipse([x - 3.5, y - 3.5, x + 3.5, y + 3.5], fill=(255, 250, 226), outline=(150, 110, 40))
    hx, hy = HEART
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = hx + sx * 46, hy + sy * 46
            d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], outline=(98, 68, 50), width=12)
            d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], outline=(240, 232, 208), width=7)
            d.ellipse([cx - 22, cy - 22, cx + 22, cy + 22], fill=(160, 184, 116))
    for rad, al in ((210, 34), (150, 60), (100, 90)):
        d.ellipse([hx - rad, hy - rad, hx + rad, hy + rad], fill=(255, 226, 140, al))
    d.ellipse([hx - 48, hy - 48, hx + 48, hy + 48], fill=(240, 232, 208), outline=(98, 68, 50), width=4)
    star(d, hx, hy, 110, 26, 8, (232, 186, 70), (120, 80, 30))
    star(d, hx, hy, 70, 16, 4, (250, 236, 200), INK, rot=math.pi / 4)
    d.ellipse([hx - 18, hy - 18, hx + 18, hy + 18], fill=(196, 52, 44), outline=INK, width=3)
    d.ellipse([hx - 6, hy - 6, hx + 6, hy + 6], fill=(255, 240, 200))


def spaced(d, xy, text, f, fill, spacing, stroke=0, stroke_fill=None):
    widths = [d.textlength(ch, font=f) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = xy[0] - total / 2
    for ch, w_ in zip(text, widths):
        d.text((x + w_ / 2, xy[1]), ch, font=f, fill=fill, anchor='mm', stroke_width=stroke, stroke_fill=stroke_fill)
        x += w_ + spacing
    return total


def fit(d, text, name, size, index, maxw, spacing):
    while size > 10:
        f = font(name, size, index)
        if sum(d.textlength(ch, font=f) for ch in text) + spacing * (len(text) - 1) <= maxw:
            return f
        size -= 1
    return font(name, size, index)


def draw_labels(d, placed, cells):
    """One line per shard, Vaelmora's letter-spaced region names, larger the more it is played."""
    halo = (244, 236, 214, 210)
    for (i, j), k in placed.items():
        name = SHARDS[k][0]
        r = ring_of(i, j)
        x0, y0 = cell_xy(i, j)
        cx, cy = x0 + C / 2, y0 + C * 0.84
        if name == 'placeholder':
            d.text((cx, cy), 'placeholder', font=font('Hoefler Text.ttc', 19, 2), fill=(120, 110, 96), anchor='mm', stroke_width=3, stroke_fill=halo)
        elif r <= 2:
            text = name.upper()
            sp = [7, 5, 3][r]
            f = fit(d, text, 'Copperplate.ttc', [36, 28, 23][r], 2 if r < 2 else 0, C * 0.96, sp)
            spaced(d, (cx, cy), text, f, (52, 38, 30), sp, stroke=4 if r == 0 else 3, stroke_fill=halo)
        else:
            f = fit(d, name, 'Hoefler Text.ttc', [0, 0, 0, 23, 21][r], 0 if r == 3 else 2, C * 0.96, 0)
            fill = (70, 56, 46) if r == 3 else (104, 88, 74)
            d.text((cx, cy), name, font=f, fill=fill, anchor='mm', stroke_width=3, stroke_fill=halo)


def ring_labels(d):
    f = font('Hoefler Text.ttc', 24, 2)
    for r, name in enumerate(RING_NAMES[1:], start=1):
        y = HEART[1] - r * P
        x = HEART[0] + P / 2
        d.text((x, y - 1), name, font=f, fill=(110, 50, 36), anchor='mm', stroke_width=5, stroke_fill=(244, 236, 214))


def furniture(canvas):
    d = SDraw(canvas)
    cream = (240, 232, 212)
    tw, th = 2100, 300
    tx, ty = (W - tw) // 2, 150
    for side in (-1, 1):
        ex = tx if side < 0 else tx + tw
        d.polygon([(ex, ty + 40), (ex + side * 150, ty + 60), (ex + side * 100, ty + th / 2), (ex + side * 150, ty + th - 60), (ex, ty + th - 40)], fill=(226, 214, 186), outline=INK, width=3)
    d.rectangle([tx, ty, tx + tw, ty + th], fill=cream, outline=INK, width=4)
    d.rectangle([tx + 14, ty + 14, tx + tw - 14, ty + th - 14], outline=INK, width=2)
    d.text((W / 2, ty + 120), 'Wildshard', font=font('Baskerville.ttc', 150, 3), fill=INK, anchor='mm')
    d.text((W / 2, ty + 222), 'the Grid at One Hundred Shards, adrift in the void  ·  a draft chart of version 1.0', font=font('Hoefler Text.ttc', 40, 2), fill=(90, 70, 56), anchor='mm')
    for side in (-1, 1):
        dx = W / 2 + side * 640
        d.polygon([(dx, ty + 108), (dx + 14, ty + 120), (dx, ty + 132), (dx - 14, ty + 120)], fill=(170, 50, 40))
        d.line([(dx + side * 30, ty + 120), (dx + side * 170, ty + 120)], fill=INK, width=2)
    compass(d, W - 380, 390, 190)

    by = GY0 + N * P + 40
    lx0, lx1 = 140, 1880
    d.rectangle([lx0, by, lx1, H - 140], fill=cream, outline=INK, width=3)
    d.rectangle([lx0 + 10, by + 10, lx1 - 10, H - 150], outline=INK, width=1)
    hf = font('Baskerville.ttc', 46, 3)
    d.text(((lx0 + lx1) / 2, by + 56), 'Legend', font=hf, fill=INK, anchor='mm')
    item = font('Hoefler Text.ttc', 29, 0)
    rows = [
        ('road', 'The Boulevard: the one thing the grid owns'),
        ('junction', 'Interchange and light column'),
        ('heart', 'The Heart of the Grid (0, 0)'),
        ('gate', 'Entry: one skinny lane at each edge (3 × 10 m)'),
        ('town', 'Hamlet, pier, sky landing, turnaround'),
        ('verge', 'Server verge: fades a shard edge to the road'),
        ('cliff', 'Cut-off edge, left high by its author'),
        ('seawall', 'Sea wall where a shard ends in water'),
        ('placeholder', 'Placeholder plot from the server'),
        ('end', 'World\'s end: the Boulevard stops, then the void'),
    ]
    yy = by + 122
    col2 = lx0 + 880
    for n_, (kind, text) in enumerate(rows):
        x = lx0 + 50 if n_ < 5 else col2
        y = yy + (n_ % 5) * 68
        legend_glyph(d, kind, x + 44, y)
        d.text((x + 104, y), text, font=item, fill=INK, anchor='lm')
    ky = yy + 5 * 68 + 14
    d.line([(lx0 + 40, ky - 14), (lx1 - 40, ky - 14)], fill=INK, width=1)
    spans = ['1–4', '5–16', '17–36', '37–64', '65–100']
    sw = (lx1 - lx0 - 80) / 5
    for r, (nm, sp) in enumerate(zip(RING_NAMES, spans)):
        x = lx0 + 40 + r * sw + sw / 2
        d.text((x, ky + 34), nm, font=font('Hoefler Text.ttc', 28, 2), fill=INK, anchor='mm')
        d.text((x, ky + 70), 'ranks ' + sp, font=font('Hoefler Text.ttc', 23, 0), fill=(110, 90, 72), anchor='mm')
    d.text(((lx0 + lx1) / 2, H - 200), 'Every shard is built alone on its own 500 m plot and slotted in by the server; nothing crosses a seam but the Boulevard.',
           font=font('Hoefler Text.ttc', 25, 2), fill=(110, 60, 40), anchor='mm')
    d.text(((lx0 + lx1) / 2, H - 168), 'Each season the most played move toward the Heart, the quiet drift out, and the world ends where the uploads do.',
           font=font('Hoefler Text.ttc', 25, 2), fill=(110, 60, 40), anchor='mm')

    rx0, rx1 = 1960, W - 140
    d.rectangle([rx0, by, rx1, H - 140], fill=cream, outline=INK, width=3)
    d.rectangle([rx0 + 10, by + 10, rx1 - 10, H - 150], outline=INK, width=1)
    d.text(((rx0 + rx1) / 2, by + 56), 'The Most Played', font=hf, fill=INK, anchor='mm')
    nf = font('Copperplate.ttc', 30, 2)
    gf = font('Hoefler Text.ttc', 26, 2)
    for k in range(16):
        name, biome, ic, genre = SHARDS[k][:4]
        x = rx0 + 60 + (k // 8) * ((rx1 - rx0 - 80) / 2)
        y = by + 124 + (k % 8) * 62
        d.text((x + 30, y - 9), f'{k + 1}.', font=font('Baskerville.ttc', 26, 1), fill=(120, 40, 30), anchor='rm')
        d.text((x + 44, y - 9), name.upper(), font=nf, fill=INK, anchor='lm')
        d.text((x + 44, y + 20), genre, font=gf, fill=(120, 40, 30), anchor='lm')
    km = 1000 * C / 500
    bx, byy = rx0 + 60, H - 214
    d.text((bx + km, byy - 36), 'Scale of kilometres', font=font('Hoefler Text.ttc', 26, 2), fill=INK, anchor='mm')
    for q in range(4):
        d.rectangle([bx + q * km / 2, byy, bx + (q + 1) * km / 2, byy + 16], fill=INK if q % 2 == 0 else cream, outline=INK, width=2)
    for q in range(5):
        d.text((bx + q * km / 2, byy + 40), f'{q * 0.5:g}', font=font('Hoefler Text.ttc', 24, 0), fill=INK, anchor='mm')
    d.text((bx + 2 * km + 50, byy + 10), 'km', font=font('Hoefler Text.ttc', 24, 2), fill=INK, anchor='lm')
    d.text((rx1 - 60, byy + 10), 'Every name on this chart is invented for the draft.', font=font('Hoefler Text.ttc', 24, 2), fill=(110, 90, 72), anchor='rm')


def legend_glyph(d, kind, x, y):
    if kind == 'road':
        d.line([(x - 44, y), (x + 44, y)], fill=(98, 68, 50), width=15)
        d.line([(x - 44, y), (x + 44, y)], fill=(240, 232, 208), width=11)
        dashed(d, [(x - 44, y), (x + 44, y)], (166, 66, 48), 1, 8, 5)
    elif kind == 'bridge':
        d.rectangle([x - 44, y - 16, x + 44, y + 16], fill=(120, 156, 176))
        for t in (-30, 0, 30):
            d.rectangle([x + t - 2, y - 11, x + t + 2, y + 11], fill=(120, 100, 86), outline=INK)
        d.line([(x - 44, y), (x + 44, y)], fill=INK, width=14)
        d.line([(x - 44, y), (x + 44, y)], fill=(226, 214, 190), width=10)
    elif kind == 'tunnel':
        for sgn in (-1, 1):
            dashed(d, [(x - 36, y + sgn * 6), (x + 36, y + sgn * 6)], INK, 2, 6, 5)
        d.arc([x - 48, y - 12, x - 24, y + 12], 0, 360, fill=INK, width=2)
        d.arc([x + 24, y - 12, x + 48, y + 12], 0, 360, fill=INK, width=2)
    elif kind == 'junction':
        d.ellipse([x - 18, y - 18, x + 18, y + 18], fill=(240, 232, 208), outline=(98, 68, 50), width=3)
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(150, 170, 110), outline=(98, 68, 50), width=2)
        d.ellipse([x - 3.5, y - 3.5, x + 3.5, y + 3.5], fill=(255, 250, 226), outline=(150, 110, 40))
    elif kind == 'heart':
        star(d, x, y, 30, 9, 8, (232, 186, 70), (120, 80, 30))
        d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(196, 52, 44), outline=INK)
    elif kind == 'gate':
        d.line([(x, y + 12), (x, y - 18)], fill=(104, 70, 52), width=5)
        d.line([(x, y + 12), (x, y - 18)], fill=(240, 230, 204), width=3)
        d.line([(x - 46, y + 12), (x + 46, y + 12)], fill=(98, 68, 50), width=13)
        d.line([(x - 46, y + 12), (x + 46, y + 12)], fill=(240, 232, 208), width=9)
    elif kind == 'town':
        for ox, oy in ((-34, 4), (-24, -4)):
            house_glyph(d, x + ox, y + oy, 4)
        d.line([(x - 6, y), (x + 8, y)], fill=(110, 80, 56), width=6)
        d.line([(x - 6, y), (x + 8, y)], fill=(196, 160, 112), width=3)
        d.ellipse([x + 16, y - 8, x + 32, y + 8], fill=(226, 216, 196), outline=INK, width=2)
        d.ellipse([x + 40, y - 6, x + 52, y + 6], fill=(236, 226, 200), outline=(104, 70, 52), width=2)
    elif kind == 'verge':
        for q in range(60):
            t = q / 59
            col = tuple(int(a * (1 - t) + b * t) for a, b in zip((120, 156, 84), VERGE))
            d.line([(x - 44 + q, y - 16), (x - 44 + q, y + 16)], fill=col)
        d.line([(x + 30, y - 16), (x + 30, y + 16)], fill=(98, 68, 50), width=12)
        d.line([(x + 30, y - 16), (x + 30, y + 16)], fill=(240, 232, 208), width=8)
    elif kind == 'cliff':
        d.rectangle([x - 44, y - 16, x - 8, y + 16], fill=(176, 170, 150))
        d.rectangle([x - 8, y - 16, x + 44, y + 16], fill=VERGE)
        for q in range(-14, 16, 5):
            d.line([(x - 8, y + q), (x + 6, y + q)], fill=(98, 74, 56), width=2)
    elif kind == 'seawall':
        d.rectangle([x - 44, y - 16, x - 6, y + 16], fill=(120, 156, 176))
        d.rectangle([x - 6, y - 16, x + 44, y + 16], fill=VERGE)
        d.line([(x - 6, y - 16), (x - 6, y + 16)], fill=(118, 110, 100), width=6)
        d.line([(x - 6, y - 16), (x - 6, y + 16)], fill=(224, 216, 200), width=3)
    elif kind == 'placeholder':
        d.rectangle([x - 26, y - 20, x + 26, y + 20], fill=(196, 202, 160))
        icon(d, 'beacon', x, y + 6, 12)
    elif kind == 'end':
        d.rectangle([x - 46, y - 18, x + 46, y + 18], fill=(24, 28, 50))
        d.line([(x - 46, y), (x + 20, y)], fill=(150, 124, 100), width=13)
        d.line([(x - 46, y), (x + 20, y)], fill=(226, 216, 196), width=10)
        for q in range(-3, 3):
            d.line([(x + 22, y + q * 4), (x + 22, y + (q + 1) * 4)], fill=(196, 52, 44) if q % 2 else (244, 240, 230), width=5)
        for sx_, sy_ in ((36, -10), (-30, 12), (40, 10)):
            d.ellipse([x + sx_ - 1.5, y + sy_ - 1.5, x + sx_ + 1.5, y + sy_ + 1.5], fill=(244, 236, 210))
    elif kind == 'lair':
        icon(d, 'lair', x, y, 30)
    elif kind == 'peak':
        peak_glyph(d, x, y + 6, 22)
    elif kind == 'river':
        pts = [(x - 44 + t * 8, y + 6 * math.sin(t)) for t in range(12)]
        d.line(pts, fill=(86, 124, 156), width=6)
        d.line(pts, fill=(126, 164, 188), width=3)


def compass(d, x, y, R):
    d.ellipse([x - R * 0.72, y - R * 0.72, x + R * 0.72, y + R * 0.72], outline=INK, width=2)
    d.ellipse([x - R * 0.64, y - R * 0.64, x + R * 0.64, y + R * 0.64], outline=INK, width=1)
    for k in range(32):
        a = k / 32 * 2 * math.pi
        d.line([(x + R * 0.64 * math.cos(a), y + R * 0.64 * math.sin(a)), (x + R * 0.72 * math.cos(a), y + R * 0.72 * math.sin(a))], fill=INK)
    star(d, x, y, R * 0.6, R * 0.1, 8, (214, 200, 170), INK, rot=math.pi / 8)
    for k in range(4):
        a = -math.pi / 2 + k * math.pi / 2
        col = (176, 40, 36) if k == 0 else (60, 50, 44)
        tip = (x + R * math.cos(a), y + R * math.sin(a))
        l_ = (x + R * 0.14 * math.cos(a - math.pi / 2), y + R * 0.14 * math.sin(a - math.pi / 2))
        r_ = (x + R * 0.14 * math.cos(a + math.pi / 2), y + R * 0.14 * math.sin(a + math.pi / 2))
        d.polygon([tip, l_, (x, y)], fill=col, outline=INK)
        d.polygon([tip, r_, (x, y)], fill=(240, 232, 212), outline=INK)
    f = font('Baskerville.ttc', 44, 1)
    for k, lab in enumerate('NESW'):
        a = -math.pi / 2 + k * math.pi / 2
        d.text((x + R * 1.18 * math.cos(a), y + R * 1.18 * math.sin(a)), lab, font=f, fill=INK, anchor='mm', stroke_width=4, stroke_fill=(240, 232, 212))
    d.ellipse([x - 8, y - 8, x + 8, y + 8], fill=(240, 232, 212), outline=INK, width=2)


def finish(canvas, rng):
    arr = np.asarray(canvas).astype(np.float32)
    yy, xx = np.mgrid[0:HS, 0:WS].astype(np.float32)
    v = np.hypot((xx - WS / 2) / (WS / 2), (yy - HS / 2) / (HS / 2))
    arr *= (1 - 0.16 * smooth(0.7, 1.45, v))[..., None]
    arr *= (0.975 + 0.05 * up(rng.random((H // 8, W // 8)), WS, HS))[..., None]
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
    d = SDraw(out)
    m = 56
    for box in ([0, 0, W, m], [0, H - m, W, H], [0, 0, m, H], [W - m, 0, W, H]):
        d.rectangle(box, fill=(226, 214, 186))
    d.rectangle([m, m, W - m, H - m], outline=INK, width=4)
    d.rectangle([m - 26, m - 26, W - m + 26, H - m + 26], outline=INK, width=2)
    seg = 120
    for x in range(m, W - m, seg):
        if (x // seg) % 2 == 0:
            d.rectangle([x, m - 16, min(x + seg, W - m), m - 6], fill=(70, 50, 40))
            d.rectangle([x, H - m + 6, min(x + seg, W - m), H - m + 16], fill=(70, 50, 40))
    for y in range(m, H - m, seg):
        if (y // seg) % 2 == 0:
            d.rectangle([m - 16, y, m - 6, min(y + seg, H - m)], fill=(70, 50, 40))
            d.rectangle([W - m + 6, y, W - m + 16, min(y + seg, H - m)], fill=(70, 50, 40))
    for (x, y) in ((W / 2, m - 11), (W / 2, H - m + 11), (m - 11, H / 2), (W - m + 11, H / 2)):
        d.polygon([(x, y - 14), (x + 14, y), (x, y + 14), (x - 14, y)], fill=(176, 40, 36), outline=INK)
    for (x, y) in ((m - 11, m - 11), (W - m + 11, m - 11), (m - 11, H - m + 11), (W - m + 11, H - m + 11)):
        d.rectangle([x - 26, y - 26, x + 26, y + 26], fill=(226, 214, 186), outline=INK, width=2)
        star(d, x, y, 22, 6, 4, (176, 40, 36), INK)
    return out


if __name__ == '__main__':
    main()
