import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import type { LoadFnOutput } from 'node:module'
import { fileURLToPath } from 'node:url'

// `@wildshard/format` ships raw TypeScript and Node will not strip types
// inside node_modules (J53), so Node-run code loads it through this small
// strip-types hook, applied only under `node_modules/@wildshard/` (J82).
// A static import would link before the hook exists: callers install it,
// then `await import(...)`. A Vercel build bundles format with esbuild
// (J53), where the hook has nothing to do.

const FORMAT_PATH = '/node_modules/@wildshard/'
const NONE = 0

function loadFormatFile(url: string): LoadFnOutput {
  const source = readFileSync(fileURLToPath(url), 'utf8')
  return {
    format: 'module',
    source: stripTypeScriptTypes(source),
    shortCircuit: true,
  }
}

function createInstaller(): () => void {
  const installed: true[] = []
  return (): void => {
    if (installed.length > NONE) {
      return
    }
    installed.push(true)
    registerHooks({
      load: (url, context, nextLoad): LoadFnOutput =>
        url.includes(FORMAT_PATH) && url.endsWith('.ts')
          ? loadFormatFile(url)
          : nextLoad(url, context),
    })
  }
}

/** Install the hook, once per process. */
const installFormatHook = createInstaller()

export { installFormatHook }
