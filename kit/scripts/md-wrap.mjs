// md-wrap.mjs — markdown prose wraps at 72 characters (Jake's norm;
// ported from kami-kakushi's md-wrap, written fresh for greenroom).
//
//   node kit/scripts/md-wrap.mjs <file...>                    reflow long prose in place
//   node kit/scripts/md-wrap.mjs --check [--new-only] <file...>  list long prose lines (exit 1)
//
// --new-only reports only lines added vs HEAD (an untracked file counts
// whole), so touching one line of an old doc doesn't flag its history.
// Exempt everywhere: front matter, code fences, tables, headings, HTML,
// block quotes, and lines whose overflow can't be broken (one long token
// such as a URL, or an `inline code` span, which is never split). Reflow rewraps only paragraphs and list items that
// hold a long line, keeping list markers and indentation.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const WIDTH = 72
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
/** @param {string} text */
export const width = text => Array.from(segmenter.segment(text)).length

const FENCE = /^\s*(```|~~~)/u
const ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/u

/**
 * Classify every line: 'prose' lines may wrap; everything else is left alone.
 * @param {string[]} lines
 * @returns {('prose' | 'item' | 'skip' | 'blank')[]}
 */
export function classify(lines) {
  const kinds = []
  let fence = false
  let front = lines[0] === '---'
  for (const [i, line] of lines.entries()) {
    if (front) {
      kinds.push('skip')
      if (i > 0 && line === '---') front = false
      continue
    }
    if (FENCE.test(line)) {
      fence = !fence
      kinds.push('skip')
      continue
    }
    const trimmed = line.trim()
    if (fence) kinds.push('skip')
    else if (trimmed === '') kinds.push('blank')
    else if (/^(#|\||<|>|---+$|\*\*\*+$|\[[^\]]+\]:)/u.test(trimmed)) kinds.push('skip')
    else if (/^ {4,}\S/u.test(line) && kinds.at(-1) === 'blank' && !isInsideList(kinds, lines)) kinds.push('skip')
    else if (ITEM.test(line)) kinds.push('item')
    else kinds.push('prose')
  }
  return kinds
}

/** An indented block right after a blank line is code unless we are inside a list. */
function isInsideList(kinds, lines) {
  for (let i = kinds.length - 1; i >= 0; i--) {
    if (kinds[i] === 'item') return true
    if (kinds[i] === 'blank' || /^\s/u.test(lines[i])) continue
    return false
  }
  return false
}

/** The text a line starts with that must stay put (indent, list marker, checkbox). */
function prefixOf(line) {
  const item = ITEM.exec(line)
  if (item) return item[0]
  return /^\s*/u.exec(line)?.[0] ?? ''
}

/**
 * Split prose into words on spaces, keeping each `inline code` span whole
 * (a command split across lines can't be copied).
 * @param {string} body
 */
export function tokens(body) {
  const out = []
  let current = ''
  let code = false
  for (const char of body) {
    if (char === '`') code = !code
    if (char === ' ' && !code) {
      if (current) out.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) out.push(current)
  return out
}

/** A long line can be wrapped only if its first word (after the prefix) fits and another follows. */
export function breakable(line) {
  const prefix = prefixOf(line)
  const words = tokens(line.slice(prefix.length))
  return words.length > 1 && width(prefix) + width(words[0]) <= WIDTH
}

/**
 * Long prose lines, 1-based.
 * @param {string} text
 * @param {Set<number> | null} only line numbers to report (null = all)
 */
export function findLong(text, only = null) {
  const lines = text.split('\n')
  const kinds = classify(lines)
  const found = []
  for (const [i, line] of lines.entries()) {
    if (only && !only.has(i + 1)) continue
    if ((kinds[i] === 'prose' || kinds[i] === 'item') && width(line) > WIDTH && breakable(line)) {
      found.push({ line: i + 1, width: width(line) })
    }
  }
  return found
}

/** Greedy wrap of words under a first-line prefix and a continuation indent. */
function wrap(words, first, rest) {
  const out = []
  let current = first
  let empty = true
  for (const word of words) {
    const candidate = empty ? current + word : `${current} ${word}`
    if (!empty && width(candidate) > WIDTH) {
      out.push(current)
      current = rest + word
    } else {
      current = candidate
    }
    empty = false
  }
  out.push(current)
  return out
}

/** Rewrap paragraphs and list items that contain a long, breakable line. */
export function reflow(text) {
  const lines = text.split('\n')
  const kinds = classify(lines)
  const out = []
  let i = 0
  while (i < lines.length) {
    if (kinds[i] !== 'prose' && kinds[i] !== 'item') {
      out.push(lines[i])
      i += 1
      continue
    }
    // A block: this line plus continuation prose lines (not a new item,
    // not after a hard break). Items continue only with indented lines.
    const start = i
    const first = prefixOf(lines[i])
    const indent = kinds[i] === 'item' ? ' '.repeat(width(first)) : first
    let end = i + 1
    while (
      end < lines.length &&
      kinds[end] === 'prose' &&
      !/( {2}|\\)$/u.test(lines[end - 1]) &&
      (kinds[start] !== 'item' || /^\s/u.test(lines[end]))
    ) {
      end += 1
    }
    const block = lines.slice(start, end)
    const needs = block.some(line => width(line) > WIDTH && breakable(line))
    if (!needs) {
      out.push(...block)
    } else {
      const hardBreak = /( {2}|\\)$/u.exec(block.at(-1))?.[0] ?? ''
      const joined = block
        .map((line, n) => (n === 0 ? line.slice(first.length) : line.trim()))
        .join(' ')
        .trim()
      const words = tokens(joined)
      const wrapped = wrap(words, first, indent)
      if (hardBreak) wrapped[wrapped.length - 1] += hardBreak
      out.push(...wrapped)
    }
    i = end
  }
  return out.join('\n')
}

/** Line numbers added vs HEAD; null = the whole file is new. */
function addedLines(file) {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', file], { encoding: 'utf8' })
  if (tracked.status !== 0) return null
  const diff = spawnSync('git', ['diff', '-U0', 'HEAD', '--', file], { encoding: 'utf8' }).stdout ?? ''
  const added = new Set()
  for (const match of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gmu)) {
    const from = Number(match[1])
    const count = match[2] === undefined ? 1 : Number(match[2])
    for (let n = from; n < from + count; n++) added.add(n)
  }
  return added
}

function main(argv) {
  const check = argv.includes('--check')
  const newOnly = argv.includes('--new-only')
  const files = argv.filter(arg => !arg.startsWith('--'))
  if (!files.length) {
    console.error('usage: node kit/scripts/md-wrap.mjs [--check [--new-only]] <file.md...>')
    return 2
  }
  let status = 0
  for (const file of files) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    if (check) {
      const long = findLong(text, newOnly ? addedLines(file) : null)
      for (const { line, width: w } of long) console.log(`  ${file}:${line}: ${w} chars (> ${WIDTH})`)
      if (long.length) status = 1
    } else {
      const next = reflow(text)
      if (next !== text) {
        writeFileSync(file, next)
        console.log(`rewrapped ${file}`)
      }
    }
  }
  return status
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
