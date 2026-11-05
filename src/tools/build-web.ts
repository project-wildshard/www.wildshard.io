// Builds the web SPA with esbuild into src/dist/web.
//   node src/tools/build-web.ts          one production build
//   node src/tools/build-web.ts --dev    watch + serve on 4404 (one process)
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { build, context } from 'esbuild'

import { readVersion } from '../cli/version.ts'
import { serve } from '../server/serve.ts'

import type { BuildOptions } from 'esbuild'

const WEB = new URL('../web/', import.meta.url)
const OUT_DIR = fileURLToPath(new URL('../dist/web/', import.meta.url))
const DEV_PORT = 4404

const OPTIONS: BuildOptions = {
  entryPoints: [fileURLToPath(new URL('main.tsx', WEB))],
  outdir: OUT_DIR,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2024',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  sourcemap: true,
  logLevel: 'info',
}

async function copyHtml(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })
  await copyFile(
    fileURLToPath(new URL('index.html', WEB)),
    `${OUT_DIR}index.html`,
  )
}

async function buildOnce(): Promise<void> {
  await copyHtml()
  await build({ ...OPTIONS, minify: true })
}

async function dev(): Promise<void> {
  await copyHtml()
  const watcher = await context(OPTIONS)
  await watcher.watch()
  // The server reads dist/web per request, so a refresh shows the new build.
  const server = await serve({ port: DEV_PORT, version: await readVersion() })
  process.stdout.write(`www.wildshard.io dev on ${server.url}\n`)
}

const { values } = parseArgs({
  options: { dev: { type: 'boolean', default: false } },
})

const run = values.dev ? dev : buildOnce
await run()
