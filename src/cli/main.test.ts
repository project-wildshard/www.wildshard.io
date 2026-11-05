import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { readVersion } from './version.ts'

const MAIN = fileURLToPath(new URL('main.ts', import.meta.url))

function cli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8' })
}

describe('the www.wildshard.io CLI', (): void => {
  it('prints the package version for --version', async (): Promise<void> => {
    const run = cli(['--version'])

    assert.equal(run.status, 0)
    assert.equal(run.stdout.trim(), await readVersion())
  })

  it('prints usage for --help and exits 0', (): void => {
    const run = cli(['--help'])

    assert.equal(run.status, 0)
    assert.match(run.stdout, /^Usage: www.wildshard.io /u)
  })

  it('rejects an unknown command with exit 1', (): void => {
    const run = cli(['nope'])

    assert.equal(run.status, 1)
    assert.match(run.stderr, /unknown command nope/u)
  })
})
