#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { serve } from '../server/serve.ts'
import { readVersion } from './version.ts'

const EXIT_OK = 0
const EXIT_USAGE = 1
const EXIT_CRASH = 2

// Arguments start after [node, script] in process.argv.
const FIRST_CLI_ARG = 2

const DEFAULT_PORT = 4404
const MIN_PORT = 0
const MAX_PORT = 65_535

const USAGE = `Usage: www.wildshard.io <command> [options]

Commands:
  serve [--port <n>]   Start the www.wildshard.io server on localhost

Options:
  --version            Print the version
  --help               Print this help
`

interface CliArgs {
  readonly command: string | undefined
  readonly help: boolean
  readonly port: string | undefined
  readonly version: boolean
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: 'boolean', default: false },
      port: { type: 'string' },
      version: { type: 'boolean', default: false },
    },
  })
  const [command] = positionals
  return {
    command,
    help: values.help,
    port: values.port,
    version: values.version,
  }
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return DEFAULT_PORT
  }
  const port = Number(raw)
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT
    ? port
    : undefined
}

async function runServe(rawPort: string | undefined): Promise<number> {
  const port = parsePort(rawPort)
  if (port === undefined) {
    process.stderr.write(
      `www.wildshard.io: invalid --port ${String(rawPort)}\n`,
    )
    return EXIT_USAGE
  }
  const server = await serve({ port, version: await readVersion() })
  process.stdout.write(`www.wildshard.io serving on ${server.url}\n`)
  return EXIT_OK
}

async function printVersion(): Promise<number> {
  process.stdout.write(`${await readVersion()}\n`)
  return EXIT_OK
}

function printUsage(code: number): number {
  process.stdout.write(USAGE)
  return code
}

async function runCommand(args: CliArgs): Promise<number> {
  if (args.command === undefined) {
    return printUsage(EXIT_USAGE)
  }
  if (args.command === 'serve') {
    return await runServe(args.port)
  }
  process.stderr.write(
    `www.wildshard.io: unknown command ${args.command}\n\n${USAGE}`,
  )
  return EXIT_USAGE
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseCliArgs(argv)
  if (args.version) {
    return await printVersion()
  }
  if (args.help) {
    return printUsage(EXIT_OK)
  }
  return await runCommand(args)
}

try {
  process.exitCode = await main(process.argv.slice(FIRST_CLI_ARG))
} catch (error: unknown) {
  process.stderr.write(`www.wildshard.io: ${String(error)}\n`)
  process.exitCode = EXIT_CRASH
}
