import { Hono } from 'hono'

import type { Health } from '../shared/health.ts'
import type { Context } from 'hono'

interface AppOptions {
  readonly version: string
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono()

  app.get('/api/health', (context: Context): Response => {
    const body: Health = { ok: true, version: options.version }
    return context.json(body)
  })

  return app
}
