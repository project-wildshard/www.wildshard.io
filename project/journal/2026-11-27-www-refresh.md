# The wildshard.io refresh (meta WWW-REFRESH)

Jake, 11-27: bring the site current: copy, facts, timeline, vision.
One plan, in meta `docs/plans/2026-11-27-opus-www-refresh-PLAN.md`;
his four calls are J535 (two doors, zone, ship alpha 2, the cleanroom
saga in place of Coming worlds).

- WW1, the facts file. `pnpm site:facts` now reads the live grid from
  api.wildshard.io's catalogue (with the agent marker) instead of a
  hand-kept list: ten zones and fifteen open plots, Mirror Salt alone
  on B1. The format pin jumped 0.4.5 to 0.82.8; the path counter
  learned five validation actions the schema grew (non_empty,
  readonly, some_item, gt_value). The format's memory gates (1.2 and
  1.8 GB) are stale, so the memory lines are hand-kept from engine
  `budgets/caps.json` (J410 1.5 GB loading, J445 1 GB playing target);
  the download lines come from the format's tiers (J338). Map labels
  moved to `tools/zones.ts`, with a test that the labels and the
  grid's zones are the same set.

- WW2, the words. A glossary comment tops COPY.md (zone, shardfile,
  the grid, open plot, Enter the MMO, Zone Select, cleanroom), and
  tools/words.ts lists the retired words. Its test counts what is left
  (179 under 137 headings at the start) and enforces once WW15 makes
  SITE_WORDS=enforce the default. The bare word shard is retired for a
  place (J535); shardfile, shard.json and the shard-* repos stay.

- WW3, the hero. J535 picked prototype C: two doors under the line,
  Play (the Driftwood capture, Play now full width, Explore and Staging
  under it) and Build (the typed prompt pane, Become a creator). It is
  the old hero's pieces laid out again under .hero.hero2, so the typing
  script and the world's frame still work. Preview left the doors for
  Explore until the fix-preview plan settles. (WW1's note says five
  validation actions; it was four.)

- WW4, the zone cards. Ten cards, one per zone on the live grid, in
  the order Driftwood, Nalati, Mirror Salt (the three a phone shows in
  full), then Sky Reach, Pine, Glowfen, Brasscap, Dunes, Nine Dragon,
  Mossgate. The four new zones' card and wide images are cut from each
  repo's own captures (shard-brasscap src/thumbs, shard-glowfen and
  shard-mirror-salt src/card, sharddev's mossgate card); Mirror Salt is
  cropped below an in-world banner to keep its race arches. Their lines
  come from the engine CHANGELOG and each zone's own quest strings.
  Every Play link is play.wildshard.io/slug/<slug>; all ten answer on
  prod with their names. The Template card is gone (Mossgate is the
  template, J434); /play/ and /build/ point at Mossgate's picture until
  WW9 and WW11. Element shots of a tall section leave off-screen tiles
  unpainted in headless shell; shoot with a tall viewport.

- WW5, one world and the FAQ. The shard.json excerpt is no longer a
  hand-kept copy of a retired template: site:facts finds Mossgate's
  live hash in the catalogue, fetches /api/shardfiles/<hash> (a brotli
  tar on R2; R2 sends Content-Encoding: br, so fetch has usually
  unpacked it), reads shard.json from the tar and keeps format,
  shardVersion, identity, requires.engine and admission.authorCaps.
  The copy drops what never shipped (co-editing, renovating abandoned
  zones, two wallets, native apps) and says what the format holds
  (J364, J525). The Thin Ice GPT mockup in the creator steps is
  replaced by Glowfen in engine (D40), on home and on /build/.

- WW6, the journey. Twelve entries from day 1 (16 Sep) to the
  cleanroom saga (26 Nov); the 20 Oct open-plots entry is gone (open
  plots are never featured). Every date is facts.json timeline.entries
  with its source, shown as {=date<Id>}, and the intro counts the weeks
  from day 1 to asOf. Two new stills: the MMO online in Signal Dunes
  (plan-artifacts mmo/go5b, cropped under its fps overlay) and Brasscap
  Mesa's cleanroom first pass (plan-artifacts brasscap-cleanroom-b1).

- WW7, where it's going. Coming worlds (six GPT concepts, D40) is
  replaced by the cleanroom saga: what it is, the zone bar (D32, D35)
  and the eight cleanroom zones, each card a capture of the zone as it
  plays today with its direction in our own words (the descriptions
  name other games; the site does not). Every card says In
  development, and the note says the pictures are today and the lines
  are next. Glowfen and Mirror Salt have no cleanroom yet, so they are
  not in it. The twelve idea-* images are deleted.

- WW8, the waitlist. The claim grid stays the 5 × 5: WW1 already put
  the live grid in facts.json and api-server's waitlist-grid.json
  (site:api-grid: same grid), so the ten zones show taken by name and
  the fifteen open plots stay claimable. api-server's claim test
  (f082d72) is the local proof: A1 is stored, a zone's cell is stored
  as no cell (the API never 400s a taken cell; the plan's done-when
  follows the code). The words say creator, zone and open plot;
  Founding Author stays.

- WW16 (home), builder first. Jake 11-27 ~21:50: recruit builders; J536
  keeps the two equal doors, so the words move. The Build door says we
  run the MMO for your zone and lists start, walk, check, share; its
  button is Become a founding builder (J536 (2): invited builders upload
  to staging). The lead cards are Driftwood, Mirror Salt, Brasscap and
  Nalati (the trailer's best frames), each with Play and its repo.
  "You build the zone. We run the MMO." replaces the cartridge block,
  which moved to /mmo/ only. Mirror Salt's story (random pitch 16 Nov,
  J395; first upload 17 Nov) sits under the creator steps. The waitlist
  asks for an invite; the FAQ answers whether you can upload today.

- WW11 under WW16, /build/ as the builder page. "Build a zone. We run
  the MMO." The start command is npx @wildshard/cli new my-zone (0.8.1,
  proven in tmp: it wrote Mossgate as src/, the guide, the four skills;
  the file list on the page is that repo's). Thin Ice's GPT chain and
  its four images are gone; Mirror Salt's story replaces it (one of four
  pitches picked at random 16 Nov, J395; on staging 17 Nov). validate
  became check; the budgets are the real ones (100 MB hard, 50 fine,
  J338; 1.5 GB loading, J410; 1 GB playing target, J445); the refusal
  line is the guide's budget-download rule. Tools: the CLI, Explore,
  the four skills, format.wildshard.io, and bringing a one-shot across
  (next, J536's default wording).

- WW9, /play/. Ten zone articles in the home order, each fact from
  meta support/www-refresh/fact-checks.md (each zone's own src/, not
  its README): the Drowned Captain, one dune ray and a crank, Aqbars the
  only snow leopard, Nine Dragon with no fights and no practice dummy,
  and new Mirror Salt, Brasscap, Glowfen and Mossgate entries. The
  singleplayer badges (Open, Early, Experimental) are gone: every zone
  is on the grid; Mossgate is tagged the template. Every article links
  its slug and its repo. The touch diagram loses the Horse button the
  game doesn't show, and the controls name what is keys only. Live
  today is the MMO (the Signal Dunes capture replaces the concept
  painting, deleted); coming next is cleanroom, founding builders and
  one-shots. /build/'s install size is 694 MB measured (npx new 0.8.1,
  pnpm install, check pass in 21 s), so about 700 MB.
