import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HealthSchema } from '../shared/health.ts'
import { createApp } from './app.ts'

describe('createApp', (): void => {
  it('answers GET /api/health with ok and the version', async (): Promise<void> => {
    const app = createApp({ version: '1.2.3' })

    const response = await app.request('/api/health')

    assert.equal(response.status, 200)
    const body: unknown = await response.json()
    assert.deepEqual(HealthSchema.parse(body), { ok: true, version: '1.2.3' })
  })

  it('answers 404 for unknown API routes', async (): Promise<void> => {
    const app = createApp({ version: '1.2.3' })

    const response = await app.request('/api/nope')

    assert.equal(response.status, 404)
  })
})
