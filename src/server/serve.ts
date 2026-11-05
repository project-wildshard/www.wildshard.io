import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

import { serve as serveNode } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'

import { createApp } from './app.ts'

// The built web app, if this repo has one: src/dist/web (src/tools/build-web.ts).
const WEB_ROOT = fileURLToPath(new URL('../dist/web', import.meta.url))

const LOOPBACK_HOST = '127.0.0.1'

interface ServeOptions {
  readonly port: number
  readonly version: string
}

interface RunningServer {
  readonly url: string
  readonly close: () => Promise<void>
}

export async function serve(options: ServeOptions): Promise<RunningServer> {
  const app = createApp({ version: options.version })
  app.use('/*', serveStatic({ root: WEB_ROOT }))
  app.get('/*', serveStatic({ root: WEB_ROOT, path: 'index.html' }))

  const server = serveNode({
    fetch: app.fetch,
    hostname: LOOPBACK_HOST,
    port: options.port,
  })
  await once(server, 'listening')

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('www.wildshard.io: server is not listening on a TCP port')
  }

  return {
    url: `http://${LOOPBACK_HOST}:${String(address.port)}`,
    close: async (): Promise<void> => {
      const closed = once(server, 'close')
      server.close()
      await closed
    },
  }
}
