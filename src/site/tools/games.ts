// The three games the site links to (J209, J212): one place for every game address on every page.
//   %PLAY_URL%          the production MMO; every "Play now" button and shard link on the site
//   <!--gen:games-->    the three links side by side: Play, Staging and Preview, each with its COPY.md label and note
// The singleplayer shell's vercel.app address is retired (J210): no page may name it.

/** The three shared links (J209): prod MMO, staging MMO, the solo preview build */
export const GAMES = Object.freeze({
  play: 'https://play.wildshard.io/',
  staging: 'https://staging.wildshard.io/',
  preview: 'https://preview.wildshard.io/',
})

type Game = keyof typeof GAMES

const ORDER: readonly Game[] = ['play', 'staging', 'preview']

const SLOT: Readonly<Record<Game, string>> = {
  play: 'Play',
  staging: 'Staging',
  preview: 'Preview',
}

/** One game link: the button's name and its one-line note both come from COPY.md */
function gameLink(game: Game): string {
  const name = SLOT[game]
  return `<a class="door game ${game} bk" href="${GAMES[game]}" target="_blank" rel="noopener">{{Games · ${name}}}<small>{{Games · ${name} note}}</small></a>`
}

/** <!--gen:games-->: Play, Staging and Preview, in that order */
export function gamesHtml(): string {
  return ORDER.map(g => gameLink(g)).join('\n      ')
}

/** Fills %PLAY_URL% and <!--gen:games--> in a page template */
export function fillGames(template: string): string {
  return template
    .replaceAll('%PLAY_URL%', GAMES.play)
    .replace('<!--gen:games-->', gamesHtml())
}
