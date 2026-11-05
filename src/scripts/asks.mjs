// asks.mjs — the ask rules (docs/tasks/asks/README.md), one parser for
// the session brief and the pre-commit hook. Ported from
// project-wildshard-singleplayer's scripts/asks.mjs.
//
//   node src/scripts/asks.mjs brief   asks still open: expired claims, picks for Jake
//   node src/scripts/asks.mjs check   pre-commit: every staged ask file follows the rules
//
// An ask is a receipt of Jake's words. Follow-up work is a plan row.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..', '..')
const ASKS = 'docs/tasks/asks'
const PLANS = 'docs/plans'
const LEASE_HOURS = 71 // a claim with no commit touching it for 71 h has expired

/** The Status vocabulary. `folded into` / `superseded by` name the ask or plan that carries the work. */
export const STATES = ['open', 'in flight', 'needs pick', 'done', 'dropped', 'folded into', 'superseded by']
const CLOSED = new Set(['done', 'dropped', 'folded into', 'superseded by'])

/** @param {string[]} args */
const git = (...args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : ''
}

/** @param {string} text */
export function parseAsk(text) {
  const status = /^\*\*Status:\*\* *(.*)$/mu.exec(text)?.[1]?.trim() ?? ''
  const lower = status.toLowerCase()
  const state = STATES.find(s => lower.startsWith(s)) ?? null
  const date = /(\d{4}-\d{2}-\d{2})/u.exec(status)?.[1] ?? null
  const target =
    state === 'folded into' || state === 'superseded by'
      ? (/^(?:folded into|superseded by) +([A-Za-z][A-Za-z0-9_-]*)/iu.exec(status)?.[1] ?? null)
      : null
  return {
    title: /^# (\S+)/u.exec(text)?.[1] ?? null,
    status,
    state,
    closed: state !== null && CLOSED.has(state),
    date,
    target,
    ask: /^\*\*Ask:\*\* *(.*)$/mu.exec(text)?.[1]?.trim() ?? '',
  }
}

/** A target exists: an ask, a live plan, or a plan archived as project/archive/<date>-<name>.md. */
/** @param {string} target */
export function targetExists(target, root = ROOT) {
  if (existsSync(resolve(root, ASKS, `${target}.md`))) return true
  if (existsSync(resolve(root, PLANS, `${target}.md`))) return true
  const archive = resolve(root, 'project/archive')
  if (!existsSync(archive)) return false
  const name = target.toLowerCase()
  return readdirSync(archive).some(f => f.toLowerCase().endsWith(`-${name}.md`) || f.toLowerCase() === `${name}.md`)
}

/**
 * Every rule an ask file must pass.
 * @param {string} id
 * @param {string} text
 * @returns {string[]} problems; empty when it passes
 */
export function checkAsk(id, text, exists = targetExists) {
  const a = parseAsk(text)
  const out = []
  if (a.title !== id) out.push(`first line must be "# ${id}" (create asks with src/scripts/ask-new.sh)`)
  if (!a.status) out.push('no **Status:** line')
  if (!a.ask) out.push("no **Ask:** line (Jake's words)")
  if (a.status && a.state === null) {
    out.push(`Status "${a.status.slice(0, 40)}" is not one of: ${STATES.join(' / ')}`)
  }
  if (a.state === 'in flight' && !/^in flight \(\d{4}-\d{2}-\d{2}, *[^)]+\)/u.test(a.status)) {
    out.push('in flight needs its claim: "in flight (YYYY-MM-DD, <owner>)"')
  }
  if ((a.state === 'open' || a.state === 'needs pick' || a.state === 'done') && !a.date) {
    out.push(`${a.state} needs its date: "${a.state} (YYYY-MM-DD)"`)
  }
  if ((a.state === 'folded into' || a.state === 'superseded by') && (a.target === null || !exists(a.target))) {
    out.push(`"${a.state}" must name an existing ask (A12) or plan (a-plan-slug)`)
  }
  return out
}

function check() {
  const staged = git('diff', '--cached', '--name-only', '--diff-filter=AM', '-z')
    .split('\0')
    .filter(p => p.startsWith(`${ASKS}/`) && p.endsWith('.md') && !p.endsWith('/README.md'))
  let bad = 0
  for (const p of staged) {
    const problems = checkAsk(basename(p, '.md'), git('show', `:${p}`))
    for (const m of problems) console.error(`    ${p}: ${m}`)
    bad += problems.length
  }
  if (bad > 0) {
    console.error('\n  X commit blocked: ask file breaks the rules in docs/tasks/asks/README.md.\n')
    process.exitCode = 1
  }
}

/** @param {string} from */
const days = (from, to = Date.now()) => (to - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

function brief() {
  const dir = resolve(ROOT, ASKS)
  const files = existsSync(dir) ? readdirSync(dir).filter(n => /^[A-Z]+\d+\.md$/u.test(n)) : []
  const now = Date.now()
  const rows = []
  for (const f of files.sort((x, y) => x.localeCompare(y, 'en', { numeric: true }))) {
    const a = parseAsk(readFileSync(resolve(dir, f), 'utf8'))
    if (a.closed) continue
    let flag = ''
    if (a.state === 'in flight') {
      const committed = Number(git('log', '-1', '--format=%ct', '--', `${ASKS}/${f}`).trim()) * 1000
      const last = Math.max(a.date ? Date.parse(`${a.date}T23:59:59Z`) : 0, committed)
      if ((now - last) / 3_600_000 > LEASE_HOURS) {
        flag = ` !! CLAIM EXPIRED (no commit in ${LEASE_HOURS} h): anyone may take it`
      }
    }
    if (a.state === 'needs pick') {
      const open = a.date ? ` (open ${Math.floor(days(a.date, now))} d)` : ''
      flag = ` !! ASK JAKE with the question tool${open}: a pick never expires`
    }
    if (a.state === null) flag = ' !! Status outside the vocabulary (docs/tasks/asks/README.md)'
    rows.push(`  ${basename(f, '.md')} | ${a.status.slice(0, 80)}${flag} | ${a.ask.slice(0, 100)}`)
  }
  console.log(rows.length > 0 ? rows.join('\n') : '  (none)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode] = process.argv.slice(2)
  if (mode === 'check') check()
  else if (mode === 'brief') brief()
  else {
    console.error('usage: node src/scripts/asks.mjs brief | check')
    process.exitCode = 2
  }
}
