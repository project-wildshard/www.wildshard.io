// How many paths the shard.json schema declares: the site's "{=schemaPaths} schema paths, every one in the generated
// reference". A port of the walk in singleplayer's scripts/docs/schema-reference.mjs (SF45), which @wildshard/format
// doesn't export: the walk visits the same nodes, and counts them instead of writing each one down. It reads trusted
// schema metadata only, and a node it doesn't know stops it, so a new valibot shape can't silently change the count.
const SCHEMAS = new Set([
  'array',
  'boolean',
  'custom',
  'exact_optional',
  'intersect',
  'lazy',
  'literal',
  'loose_object',
  'never',
  'null',
  'nullable',
  'number',
  'object',
  'object_with_rest',
  'optional',
  'picklist',
  'record',
  'strict_object',
  'strict_tuple',
  'string',
  'tuple',
  'tuple_with_rest',
  'union',
  'variant',
  'unknown',
])
const ACTIONS = new Set([
  'check',
  'finite',
  'integer',
  'length',
  'max_length',
  'max_entries',
  'max_value',
  'min_entries',
  'min_length',
  'min_value',
  'multiple_of',
  'raw_check',
  'raw_transform',
  'transform',
  'regex',
  'safe_integer',
])
const WRAPPERS = new Set(['optional', 'exact_optional', 'nullable'])
const OBJECTS = new Set([
  'object',
  'strict_object',
  'loose_object',
  'object_with_rest',
])
const TUPLES = new Set(['tuple', 'strict_tuple', 'tuple_with_rest'])
const BRANCHES = new Set(['union', 'variant', 'intersect'])
const MAX_DEPTH = 64
const MAX_PATHS = 100_000

interface Node {
  readonly kind?: unknown
  readonly type?: unknown
  readonly pipe?: unknown
  readonly wrapped?: unknown
  readonly entries?: unknown
  readonly rest?: unknown
  readonly item?: unknown
  readonly key?: unknown
  readonly value?: unknown
  readonly items?: unknown
  readonly options?: unknown
}

function node(v: unknown, path: string): Node {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`schema paths: no schema at ${path}`)
  }
  return v
}

function parts(v: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(v)) {
    throw new Error(`schema paths: no list at ${path}`)
  }
  return v
}

/** The schema a pipeline ends on: its last schema step, followed down */
function unwrap(input: Node, path: string, seen: Set<Node>): Node {
  if (!Array.isArray(input.pipe)) {
    return input
  }
  if (seen.has(input) || seen.size >= MAX_DEPTH) {
    throw new Error(`schema paths: a recursive pipeline at ${path}`)
  }
  seen.add(input)
  let base = input
  for (const step of parts(input.pipe, path)) {
    const part = node(step, path)
    if (part.kind === 'schema') {
      base = unwrap(part, path, seen)
    } else if (!ACTIONS.has(String(part.type))) {
      throw new Error(
        `schema paths: an unknown action at ${path}: ${String(part.type)}`,
      )
    }
  }
  seen.delete(input)
  return base
}

/** The child schemas of one node, each with its path */
function children(base: Node, path: string): readonly [unknown, string][] {
  const type = String(base.type)
  if (OBJECTS.has(type)) {
    const fields = node(base.entries, path)
    const named = Object.keys(fields)
      .toSorted()
      .map((key): [unknown, string] => [
        (fields as Record<string, unknown>)[key],
        `${path}.${key}`,
      ])
    return type === 'object_with_rest'
      ? [...named, [base.rest, `${path}{rest}`]]
      : named
  }
  if (type === 'array') {
    return [[base.item, `${path}[]`]]
  }
  if (type === 'record') {
    return [
      [base.key, `${path}{key}`],
      [base.value, `${path}{value}`],
    ]
  }
  if (TUPLES.has(type)) {
    const items = parts(base.items, path).map(
      (item, index): [unknown, string] => [item, `${path}[${index}]`],
    )
    return type === 'tuple_with_rest'
      ? [...items, [base.rest, `${path}[rest]`]]
      : items
  }
  if (BRANCHES.has(type)) {
    const mark = type === 'intersect' ? '&' : ''
    return parts(base.options, path).map((option, index) => [
      option,
      `${path}${mark}<${index}>`,
    ])
  }
  return []
}

export function schemaPathCount(schema: unknown): number {
  const stack = new Set<Node>()
  let count = 0
  function visit(value: unknown, path: string): void {
    const input = node(value, path)
    if (input.kind !== 'schema' || !SCHEMAS.has(String(input.type))) {
      throw new Error(
        `schema paths: an unknown schema at ${path}: ${String(input.type)}`,
      )
    }
    if (stack.has(input)) {
      throw new Error(`schema paths: a recursive schema at ${path}`)
    }
    if (stack.size >= MAX_DEPTH || count >= MAX_PATHS) {
      throw new Error(`schema paths: past the limits at ${path}`)
    }
    stack.add(input)
    const base = unwrap(input, path, new Set())
    if (!SCHEMAS.has(String(base.type))) {
      throw new Error(
        `schema paths: an unknown schema at ${path}: ${String(base.type)}`,
      )
    }
    if (WRAPPERS.has(String(base.type))) {
      visit(base.wrapped, path)
    } else {
      count += 1
      for (const [child, at] of children(base, path)) {
        visit(child, at)
      }
    }
    stack.delete(input)
  }
  visit(schema, '$')
  return count
}
