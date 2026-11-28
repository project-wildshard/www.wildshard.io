// The site's words (meta WWW-REFRESH WW2, J535): what a player reads matches what the game says. The glossary is the
// comment at the top of COPY.md; this is the list of words the site no longer uses, and the check that finds them.
//   retiredWords(copy)   every retired word in COPY.md's text, with the heading it sits under
// The page templates hold no prose of their own (every word is a COPY.md slot), so COPY.md is the whole check.

/** A retired word or phrase, and what to say instead */
export interface Retired {
  readonly pattern: RegExp
  readonly instead: string
}

/** A heading's text and the retired word found in it */
export interface Hit {
  readonly key: string
  readonly found: string
  readonly instead: string
}

export const RETIRED: readonly Retired[] = [
  // J535 (2): the player's word is zone; shardfile is the file a creator uploads. Wildshard, shardfile, shard.json and
  // the shard-* repo names stay.
  {
    pattern: /(?<![\w./@-])shards?(?![\w-]|\.\w)/giu,
    instead: 'zone, or shardfile for the file',
  },
  { pattern: /single[- ]player alpha/giu, instead: 'the MMO' },
  {
    pattern: /\bseven (?:shards|zones)\b/giu,
    instead: 'the count from facts.json',
  },
  { pattern: /\brevision\b/giu, instead: 'version (J524)' },
  { pattern: /\?chunk=/gu, instead: 'a /slug/<slug> share link (J522)' },
  {
    pattern: /\b(?:code|data) shards?\b/giu,
    instead: 'one shard format (J364)',
  },
  { pattern: /\bfirst[- ]party\b/giu, instead: 'one shard format (J364)' },
  { pattern: /\bInfinite Wildshard\b/gu, instead: 'Enter the MMO (J387)' },
  { pattern: /\bShard Select\b/gu, instead: 'Zone Select (J387)' },
]

export function retiredWords(
  copy: ReadonlyMap<string, string>,
): readonly Hit[] {
  const hits: Hit[] = []
  for (const [key, text] of copy) {
    for (const { pattern, instead } of RETIRED) {
      for (const m of text.matchAll(pattern)) {
        hits.push({ key, found: m[0], instead })
      }
    }
  }
  return hits
}
