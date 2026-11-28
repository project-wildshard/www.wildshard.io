// The three games the site links to (J209, J212; meta WWW-REFRESH WW3): one place for every game address on every page.
//   %PLAY_URL%          the production MMO; every "Play now" button and zone link on the site
//   <!--gen:games-->    the three links: Play, Explore and Staging, each with its COPY.md label and note. Preview
//                       leaves the doors until the meta fix-preview plan settles what it is.
// The singleplayer shell's vercel.app address is retired (J210): no page may name it.

/** The three shared links: the prod MMO, the solo Explore app (J463), the staging MMO */
export const GAMES = Object.freeze({
  play: 'https://play.wildshard.io/',
  explore: 'https://explore.wildshard.io/',
  staging: 'https://staging.wildshard.io/',
})

type Game = keyof typeof GAMES

const ORDER: readonly Game[] = ['play', 'explore', 'staging']

const SLOT: Readonly<Record<Game, string>> = {
  play: 'Play',
  explore: 'Explore',
  staging: 'Staging',
}

/** One game link: the button's name and its one-line note both come from COPY.md */
function gameLink(game: Game): string {
  const name = SLOT[game]
  return `<a class="door game ${game} bk" href="${GAMES[game]}" target="_blank" rel="noopener">{{Games · ${name}}}<small>{{Games · ${name} note}}</small></a>`
}

/** <!--gen:games-->: Play, Explore and Staging, in that order */
export function gamesHtml(): string {
  return ORDER.map(g => gameLink(g)).join('\n      ')
}

/** Fills %PLAY_URL% and <!--gen:games--> in a page template */
export function fillGames(template: string): string {
  return template
    .replaceAll('%PLAY_URL%', GAMES.play)
    .replace('<!--gen:games-->', gamesHtml())
}
