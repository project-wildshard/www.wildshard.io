# The three game links

Jake, 2026-11-09 (J212): "We are just fixing the buttons and the link
from marketing website to the deployed games." J209 names the three
links friends and testers share: Play (the production MMO,
play.wildshard.io), Staging (the staging MMO, staging.wildshard.io) and
Preview (the newest solo build, preview.wildshard.io).

The site had 22 links to wildshard-singleplayer.vercel.app, the shell
J210 retires. Every one is now %PLAY_URL%, which the build fills from
src/site/tools/games.ts, the one place a game address lives. The home
hero and the top of /play/ carry all three side by side through
<!--gen:games-->, each with a one-line note saying which game it opens.
The status line under them is now the roadmap, with no dates: the
Friends grid, sign-in, the public grid of 25 shards, then uploads.
"Become an author" moves under them as a single bar.

games.test.ts fails if a template names a game address itself or the
three links drift. The redesign (WWW-PLAN W3 to W6) stays parked.
Meta plan: docs/plans/WWW-PLAN.md.
