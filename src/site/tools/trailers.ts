// The home page's two trailers (meta ALPHA-2-TRAILER AT13, J520): the current one in the big slot and the one it replaced
// as "Alpha 1" in a smaller slot under it. Both are plain <video> tags; media.json (tools/publish-media.ts) names their
// encodes, and the build writes them straight into the tags:
//   %TRAILER_WIDE% / %TRAILER_PHONE%   the current trailer's 1280 and 1080 encodes
//   %ALPHA1_WIDE% / %ALPHA1_POSTER%    the alpha 1 trailer's encode and poster

/** An object's own fields, or null for anything else */
export function fields(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : null
}

/** Text safe inside an HTML attribute */
export function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Two of one trailer's string fields, or an error naming what media.json lacks */
function pick(
  media: unknown,
  key: string,
  a: string,
  b: string,
): [string, string] {
  const row = fields(fields(media)?.[key]) ?? {}
  const get = (name: string): string => {
    const value = row[name]
    if (typeof value !== 'string') {
      throw new TypeError(`src/site/media.json has no ${key}.${name}`)
    }
    return value
  }
  return [get(a), get(b)]
}

/** The page with both trailers' encodes in their <source> tags */
export function fillTrailers(html: string, media: unknown): string {
  let out = html
  if (out.includes('%TRAILER_PHONE%')) {
    const [mp4, mp4Phone] = pick(media, 'trailer', 'mp4', 'mp4Phone')
    out = out
      .replace('%TRAILER_PHONE%', esc(mp4Phone))
      .replace('%TRAILER_WIDE%', esc(mp4))
  }
  if (out.includes('%ALPHA1_')) {
    const [mp4, poster] = pick(media, 'alpha1', 'mp4', 'poster')
    out = out
      .replace('%ALPHA1_WIDE%', esc(mp4))
      .replace('%ALPHA1_POSTER%', esc(poster))
  }
  return out
}
