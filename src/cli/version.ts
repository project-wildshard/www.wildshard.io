import { readFile } from 'node:fs/promises'

import { object, parse, string } from 'valibot'

const PackageJsonSchema = object({ version: string() })

// The package root is the repo root: package.json beside src/.
const PACKAGE_JSON_URL = new URL('../../package.json', import.meta.url)

export async function readVersion(): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(PACKAGE_JSON_URL, 'utf8'))
  return parse(PackageJsonSchema, raw).version
}
