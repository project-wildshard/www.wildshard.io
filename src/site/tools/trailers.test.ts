import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fillTrailers } from './trailers.ts'

// Meta ALPHA-2-TRAILER AT13 (J520): the new trailer takes the big slot and the
// October one stays under it as Alpha 1, each tag filled from media.json.

const PAGE =
  '<source src="%TRAILER_WIDE%"><source src="%TRAILER_PHONE%">' +
  '<video poster="%ALPHA1_POSTER%"><source src="%ALPHA1_WIDE%"></video>'
const MEDIA = {
  trailer: { mp4: '/media/v/a2-1280.mp4', mp4Phone: '/media/v/a2-1080.mp4' },
  alpha1: { mp4: '/media/v/a1-1280.mp4', poster: '/media/a1.webp' },
}

test('both trailers land in their own tags', () => {
  assert.equal(
    fillTrailers(PAGE, MEDIA),
    '<source src="/media/v/a2-1280.mp4"><source src="/media/v/a2-1080.mp4">' +
      '<video poster="/media/a1.webp"><source src="/media/v/a1-1280.mp4"></video>',
  )
})

test('a page that asks for alpha 1 refuses a manifest without it', () => {
  assert.throws(
    () => fillTrailers(PAGE, { trailer: MEDIA.trailer }),
    /no alpha1\.mp4/u,
  )
})

test('a page without the slots is left alone', () => {
  assert.equal(fillTrailers('<p>hi</p>', {}), '<p>hi</p>')
})
