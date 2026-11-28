// The share cards (og.jpg, og-play.jpg, ...): one HTML card per page, shot headless at 1200 x 630.
// node art/og/make-og.mjs, from the repo root, after `pnpm site:build` (it reads the built site's fonts and media).
// Muted, headless, mock keychain (AGENTS.md). Each card: the line, the two doors in words, a capture and its tag.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const SITE = 'src/site/public'
const CARDS = [
  { out: 'og.jpg', image: 'media/wide-driftwood.webp', tag: 'In engine · Driftwood Isle' },
  { out: 'og-play.jpg', image: 'media/wide-mirrorsalt.webp', tag: 'In engine · Mirror Salt' },
  { out: 'og-build.jpg', image: 'media/wide-mossgate.webp', tag: 'In engine · Mossgate Hollow, the template' },
  { out: 'og-mmo.jpg', image: 'media/wide-dunes.webp', tag: 'In engine · Signal Dunes' },
  { out: 'og-map.jpg', image: 'map/tiles/3/1_1.webp', tag: 'Concept · a draft of the world after 100 zones' },
]

const page = card => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Rajdhani; font-weight: 700; src: url(${url('fonts/rajdhani-700.woff2')}); }
@font-face { font-family: Rajdhani; font-weight: 600; src: url(${url('fonts/rajdhani-600.woff2')}); }
@font-face { font-family: Mono; src: url(${url('fonts/jetbrainsmono.woff2')}); }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; background: #050a12; color: #e8f6ff; font-family: Rajdhani; position: relative; overflow: hidden; }
.shot { position: absolute; inset: 0 0 0 380px; background: url(${url(card.image)}) center / cover; }
.fade { position: absolute; inset: 0; background: linear-gradient(90deg, #050a12 34%, rgba(5,10,18,.86) 50%, rgba(5,10,18,0) 74%); }
.text { position: absolute; left: 56px; top: 58px; width: 560px; }
.brand { display: flex; align-items: center; gap: 14px; }
.brand img { width: 46px; height: 46px; }
.brand small { display: block; font: 13px Mono; letter-spacing: .32em; color: #8ea6ba; }
.brand b { display: block; font-size: 40px; line-height: .9; letter-spacing: .04em; color: #bfeeff; text-shadow: 0 0 18px rgba(143,227,255,.5); }
h1 { margin-top: 64px; font-size: 64px; line-height: .98; text-transform: uppercase; letter-spacing: .01em; }
h1 em { font-style: normal; color: #a487ff; }
p { margin-top: 26px; font: 19px/1.55 Mono; color: #b3c8d8; }
.url { position: absolute; left: 56px; bottom: 44px; font: 15px Mono; letter-spacing: .18em; color: #8fe3ff; }
.tag { position: absolute; right: 28px; top: 26px; padding: 6px 12px; background: rgba(5,10,18,.82); border: 1px solid #c9a24a; font: 14px Mono; letter-spacing: .14em; text-transform: uppercase; color: #f2d48a; }
.corner { position: absolute; width: 22px; height: 22px; border-color: rgba(143,227,255,.6); border-style: solid; }
.tl { left: 14px; top: 14px; border-width: 2px 0 0 2px; } .bl { left: 14px; bottom: 14px; border-width: 0 0 2px 2px; }
.br { right: 14px; bottom: 14px; border-width: 0 2px 2px 0; }
</style></head><body>
<div class="shot"></div><div class="fade"></div>
<div class="text">
  <div class="brand"><img src="${url('favicon.svg')}" alt=""><span><small>PROJECT</small><b>WILDSHARD</b></span></div>
  <h1>The MMO whose world is built by its <em>players.</em></h1>
  <p>Play it in your browser.<br>Build a zone with Claude Code.</p>
</div>
<div class="url">◆ WILDSHARD.IO</div>
<span class="tag">${card.tag}</span>
<i class="corner tl"></i><i class="corner bl"></i><i class="corner br"></i>
</body></html>`

function url(path) {
  return pathToFileURL(`${process.cwd()}/${SITE}/${path}`).href
}

// PW_CHROMIUM names a headless shell when the one this Playwright pins isn't installed
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PW_CHROMIUM,
  args: ['--mute-audio', '--use-mock-keychain', '--password-store=basic'],
})
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } })
for (const card of CARDS) {
  const html = `${process.cwd()}/tmp/og/card.html`
  mkdirSync(`${process.cwd()}/tmp/og`, { recursive: true })
  writeFileSync(html, page(card))
  await tab.goto(pathToFileURL(html).href)
  await tab.evaluate(async () => {
    await document.fonts.ready
  })
  await tab.waitForTimeout(300)
  await tab.screenshot({ path: `${SITE}/${card.out}`, type: 'jpeg', quality: 86 })
  console.log(card.out, readFileSync(`${SITE}/${card.out}`).length, 'bytes')
}
await browser.close()
rmSync(`${process.cwd()}/tmp/og`, { recursive: true, force: true })
