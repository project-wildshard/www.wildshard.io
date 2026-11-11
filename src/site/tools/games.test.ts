import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { fillGames, GAMES, gamesHtml } from './games.ts'

// J212: the site links the three games (Play, Staging, Preview) and nothing
// else. The bug this file exists for: 22 links to the retired shell's
// wildshard-singleplayer.vercel.app across five templates.

const site = new URL('../', import.meta.url)
const PAGES = [
  'index.html',
  'play/index.html',
  'build/index.html',
  'mmo/index.html',
  'map/index.html',
  '404.html',
]

const page = (p: string): string =>
  readFileSync(new URL(p, site).pathname, 'utf8')

test('no page names a game address of its own', () => {
  for (const p of PAGES) {
    const html = page(p)
    assert.doesNotMatch(html, /vercel\.app/u, p)
    assert.doesNotMatch(html, /https:\/\/(play|staging|preview)\./u, p)
  }
})

test('every Play button lands on the production MMO', () => {
  for (const p of PAGES) {
    const html = fillGames(page(p))
    assert.doesNotMatch(html, /%PLAY_URL%/u, p)
    assert.ok(html.includes(`href="${GAMES.play}"`), p)
  }
})

test('the three links go Play, Staging, Preview, each with its own copy', () => {
  const hrefs = [...gamesHtml().matchAll(/href="(?<h>[^"]+)"/gu)].map(
    m => m.groups?.h,
  )
  assert.deepEqual(hrefs, [
    'https://play.wildshard.io/',
    'https://staging.wildshard.io/',
    'https://preview.wildshard.io/',
  ])
  for (const name of ['Play', 'Staging', 'Preview']) {
    assert.ok(gamesHtml().includes(`{{Games · ${name}}}`), name)
    assert.ok(gamesHtml().includes(`{{Games · ${name} note}}`), name)
  }
})

test('home and /play/ both carry the three links', () => {
  for (const p of ['index.html', 'play/index.html']) {
    assert.ok(page(p).includes('<!--gen:games-->'), p)
  }
})
