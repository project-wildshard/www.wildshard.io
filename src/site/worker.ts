// The marketing site's Worker (meta WWW-CLOUDFLARE-PLAN, J271). Static assets do the work; this only:
// - sends www.wildshard.io to the apex with a 308, as Vercel did;
// - serves the trailer and shard loops from R2 at /media/v/<name>.mp4 (key site/media/<name>.mp4), with ranges;
// - sets the cache headers Vercel's public/vercel.json used to set.
// The bucket is the private wildshard-records: only a hashed mp4 name under site/media/ is ever read.

interface Fetcher {
  fetch: (request: Request) => Promise<Response>
}

interface R2Range {
  readonly offset?: number
  readonly length?: number
  readonly suffix?: number
}

interface R2Object {
  readonly size: number
  readonly httpEtag: string
  readonly range?: R2Range
  readonly body?: ReadableStream
  writeHttpMetadata: (headers: Headers) => void
}

interface R2Bucket {
  get: (
    key: string,
    options: { range: Headers; onlyIf: Headers },
  ) => Promise<R2Object | null>
}

interface Env {
  readonly ASSETS: Fetcher
  readonly MEDIA: R2Bucket
}

const APEX = 'wildshard.io'
const MEDIA = /^\/media\/v\/(?<name>[a-z0-9-]+\.mp4)$/u
const YEAR = 'public, max-age=31536000, immutable'

const CACHE: readonly (readonly [string, string])[] = [
  ['/assets/', YEAR],
  ['/media/', 'public, max-age=86400'],
  ['/map/tiles/', 'public, max-age=86400'],
  ['/fonts/', 'public, max-age=2592000'],
]

function cacheFor(path: string): string {
  const hit = CACHE.find(([prefix]) => path.startsWith(prefix))
  return hit ? hit[1] : 'public, max-age=0, must-revalidate'
}

function contentRange(range: R2Range, size: number): string {
  let start = range.offset ?? 0
  let length = range.length ?? size - start
  if (range.suffix !== undefined) {
    length = Math.min(range.suffix, size)
    start = size - length
  }
  return `bytes ${String(start)}-${String(start + length - 1)}/${String(size)}`
}

async function media(
  request: Request,
  env: Env,
  name: string,
): Promise<Response> {
  const object = await env.MEDIA.get(`site/media/${name}`, {
    range: request.headers,
    onlyIf: request.headers,
  })
  if (!object) {
    return new Response('Not found', { status: 404 })
  }
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('accept-ranges', 'bytes')
  headers.set('cache-control', YEAR)
  if (!object.body) {
    return new Response(null, { status: 304, headers })
  }
  const range = request.headers.has('range') ? object.range : undefined
  if (range) {
    headers.set('content-range', contentRange(range, object.size))
  }
  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: range ? 206 : 200,
    headers,
  })
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.hostname === `www.${APEX}`) {
    return Response.redirect(`https://${APEX}${url.pathname}${url.search}`, 308)
  }
  const name = MEDIA.exec(url.pathname)?.groups?.name
  if (name !== undefined) {
    return await media(request, env, name)
  }
  const asset = await env.ASSETS.fetch(request)
  const response = new Response(asset.body, asset)
  if (asset.ok) {
    response.headers.set('cache-control', cacheFor(url.pathname))
  }
  return response
}

const worker = { fetch: handle }

// oxlint-disable-next-line import/no-default-export -- the Workers runtime loads the module's default export
export default worker
