// Publishes the marketing site's motion (MARKETING-SITE MS11) to R2 and writes src/site/media.json.
//
//   node src/site/tools/publish-media.ts <folder>
//
// <folder> holds the encoded loops (kept out of git): `trailer-1280.mp4`, `trailer-1080.mp4` (the phone copy, 1920 × 1080;
// an older folder's `trailer-720.mp4` is taken when there is none) and, for any shards whose loops
// change, `<slug>-card.mp4` (5:4, the phone card) and `<slug>-wide.mp4` (16:9, the desktop card). Each file is uploaded once,
// under a content-hashed key (`site/media/<name>-<hash8>.mp4`) in the private R2 bucket wildshard-records, which the site's
// Worker serves at `/media/v/<name>-<hash8>.mp4` (worker.ts; meta WWW-CLOUDFLARE-PLAN). A re-run with unchanged files
// uploads nothing and a changed file gets a new URL (cached a year). Uploads go through `wrangler r2 object put`, so
// wrangler's own login is the credential. The poster is a small WebP in
// src/site/public/media/, served by the site itself.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

interface Trailer {
  mp4: string
  mp4Phone: string
  poster: string
}

interface Loop {
  card: string
  wide: string
}

interface Media {
  trailer: Trailer
  loops: Record<string, Loop>
}

const POSTER = '/media/trailer-alpha-poster.webp' // Renamed when the alpha trailer replaced the loop, so cached phones fetch it

const manifestPath = resolve(import.meta.dirname, '..', 'media.json')

const BUCKET = 'wildshard-records'

function hash8(path: string): string {
  return createHash('sha256')
    .update(readFileSync(path))
    .digest('hex')
    .slice(0, 8)
}

/** Every URL the current manifest already names, so an unchanged file is not uploaded again. */
function knownUrls(): string[] {
  if (!existsSync(manifestPath)) {
    return []
  }
  const urls: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      urls.push(v)
    } else if (typeof v === 'object' && v !== null) {
      for (const x of Object.values(v)) walk(x)
    }
  }
  walk(JSON.parse(readFileSync(manifestPath, 'utf8')))
  return urls
}

function publish(dir: string, file: string, known: string[]): string {
  const path = join(dir, file)
  if (!existsSync(path)) {
    throw new Error(`publish-media: missing ${path}`)
  }
  const name = `${basename(file, '.mp4')}-${hash8(path)}.mp4`
  const url = `/media/v/${name}`
  if (known.includes(url)) {
    console.info(`  = ${name}`)
    return url
  }
  execFileSync(
    'wrangler',
    [
      'r2',
      'object',
      'put',
      `${BUCKET}/site/media/${name}`,
      '--file',
      path,
      '--content-type',
      'video/mp4',
      '--cache-control',
      'public, max-age=31536000, immutable',
      '--remote',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  console.info(`  + ${name} (${Math.round(statSync(path).size / 1024)} KB)`)
  return url
}

function main(): void {
  const arg = process.argv[2]
  if (!arg) {
    throw new Error(
      'usage: node src/site/tools/publish-media.ts <folder with the encoded mp4s>',
    )
  }
  const dir = resolve(arg)
  const known = knownUrls()

  const slugs = readdirSync(dir)
    .filter(f => f.endsWith('-card.mp4'))
    .map(f => f.slice(0, -'-card.mp4'.length))
    .filter(s => existsSync(join(dir, `${s}-wide.mp4`)))

  const media: Media = {
    trailer: {
      mp4: publish(dir, 'trailer-1280.mp4', known),
      // The phone copy: 1080p since MS24 (a 720 px copy upscaled ~2x on a 3x phone); an older folder's 720 still works
      mp4Phone: publish(
        dir,
        existsSync(join(dir, 'trailer-1080.mp4'))
          ? 'trailer-1080.mp4'
          : 'trailer-720.mp4',
        known,
      ),
      poster: POSTER,
    },
    // Start from the loops the manifest already names: the folder only replaces the shards it holds (the page looks
    // loops up by slug, so their order doesn't matter)
    loops: existsSync(manifestPath)
      ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Media).loops
      : {},
  }
  for (const slug of slugs) {
    media.loops[slug] = {
      card: publish(dir, `${slug}-card.mp4`, known),
      wide: publish(dir, `${slug}-wide.mp4`, known),
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(media, null, 2)}\n`)
  console.info(
    `publish-media: wrote ${manifestPath} (${Object.keys(media.loops).length} shard loops)`,
  )
}

main()
