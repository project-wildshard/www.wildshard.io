// Publishes the marketing site's motion (MARKETING-SITE MS11) to Vercel Blob and writes site/media.json.
//
//   node site/tools/publish-media.ts <folder>
//
// <folder> holds the encoded loops (kept out of git): `trailer-1280.mp4`, `trailer-1080.mp4` (the phone copy, 1920 × 1080;
// an older folder's `trailer-720.mp4` is taken when there is none) and, for any shards whose loops
// change, `<slug>-card.mp4` (5:4, the phone card) and `<slug>-wide.mp4` (16:9, the desktop card). Each file is uploaded once,
// public, under a content-hashed name (`site/media/<name>-<hash8>.mp4`), so a re-run with unchanged files uploads
// nothing and a changed file gets a new URL (the Blob CDN caches a year). The poster is a small WebP in
// site/public/media/, served by the site itself.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

interface Trailer {
  mp4: string;
  mp4Phone: string;
  poster: string;
}

interface Loop {
  card: string;
  wide: string;
}

interface Media {
  trailer: Trailer;
  loops: Record<string, Loop>;
}

const POSTER = '/media/trailer-alpha-poster.webp'; // renamed when the alpha trailer replaced the loop, so cached phones fetch it

const manifestPath = resolve(import.meta.dirname, '..', 'media.json');

function blobToken(): string {
  const { BLOB_READ_WRITE_TOKEN: env } = process.env;
  if (env) return env;
  const file = join(homedir(), '.config', 'wildshard-drafts', 'blob.env');
  if (existsSync(file)) {
    const m = /BLOB_READ_WRITE_TOKEN="?([^"\n]+)"?/.exec(readFileSync(file, 'utf8'));
    if (m?.[1]) return m[1];
  }
  throw new Error('no Blob token: set BLOB_READ_WRITE_TOKEN or write ~/.config/wildshard-drafts/blob.env');
}

function hash8(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 8);
}

/** Every URL the current manifest already names, so an unchanged file is not uploaded again. */
function knownUrls(): string[] {
  if (!existsSync(manifestPath)) return [];
  const urls: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') urls.push(v);
    else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) walk(x);
  };
  walk(JSON.parse(readFileSync(manifestPath, 'utf8')));
  return urls;
}

async function publish(dir: string, file: string, token: string, known: string[]): Promise<string> {
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`publish-media: missing ${path}`);
  const pathname = `site/media/${basename(file, '.mp4')}-${hash8(path)}.mp4`;
  const prior = known.find((u) => u.endsWith(`/${pathname}`));
  if (prior) {
    console.info(`  = ${pathname}`);
    return prior;
  }
  const { put } = await import('@vercel/blob');
  const res = await put(pathname, readFileSync(path), {
    access: 'public',
    token,
    contentType: 'video/mp4',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31_536_000,
  });
  console.info(`  + ${pathname} (${Math.round(statSync(path).size / 1024)} KB)`);
  return res.url;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) throw new Error('usage: node site/tools/publish-media.ts <folder with the encoded mp4s>');
  const dir = resolve(arg);
  const token = blobToken();
  const known = knownUrls();

  const slugs = readdirSync(dir)
    .filter((f) => f.endsWith('-card.mp4'))
    .map((f) => f.slice(0, -'-card.mp4'.length))
    .filter((s) => existsSync(join(dir, `${s}-wide.mp4`)));

  const media: Media = {
    trailer: {
      mp4: await publish(dir, 'trailer-1280.mp4', token, known),
      // the phone copy: 1080p since MS24 (a 720 px copy upscaled ~2x on a 3x phone); an older folder's 720 still works
      mp4Phone: await publish(dir, existsSync(join(dir, 'trailer-1080.mp4')) ? 'trailer-1080.mp4' : 'trailer-720.mp4', token, known),
      poster: POSTER,
    },
    // start from the loops the manifest already names: the folder only replaces the shards it holds (the page looks
    // loops up by slug, so their order doesn't matter)
    loops: existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Media).loops : {},
  };
  for (const slug of slugs) {
    media.loops[slug] = {
      card: await publish(dir, `${slug}-card.mp4`, token, known),
      wide: await publish(dir, `${slug}-wide.mp4`, token, known),
    };
  }
  writeFileSync(manifestPath, `${JSON.stringify(media, null, 2)}\n`);
  console.info(`publish-media: wrote ${manifestPath} (${Object.keys(media.loops).length} shard loops)`);
}

await main();
