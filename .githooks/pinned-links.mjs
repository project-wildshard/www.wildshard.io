// Pinned-links guard. Every node_modules/@wildshard/* alias this repo
// declares must resolve inside its pnpm install (the store, or a classic
// node_modules/.pnpm), the same bytes CI tests. An alias that resolves to
// a live source checkout, usually a leftover repo-kit `local link`, makes
// local checks run other lanes' half-done engine/SDK/format edits.
//   commit lane: warn.   push lane: refuse.
// A deliberate link carries a receipt in the checkout's git dir,
// `git rev-parse --git-path wildshard-local-link.json`, naming the lane,
// why, an expiry at most 24 h ahead and each link it allows:
//   {"lane": "<lane>", "reason": "<why>", "expires": "<ISO>",
//    "links": {"@wildshard/engine": "<the checkout it points at>"}}
// Only that lane's push passes (WS_LANE_NAME=<lane>); any other lane
// pushing from the checkout is still refused, since its checks ran on
// the linking lane's source.
// Run it by hand: node .githooks/pinned-links.mjs  (exit 1 when refused)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const RECEIPT = 'wildshard-local-link.json';
const MAX_AHEAD = 24 * 3_600_000;
const SHAPE = '{"lane": "<lane>", "reason": "<why>", "expires": "<ISO, at most 24 h ahead>", "links": {"<name>": "<target>"}}';
const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options });

function json(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function realOrUndefined(path) {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/** The node_modules Node would search: the root's own, else the nearest ancestor's (a worktree made with --no-install). */
function modulesDir(root) {
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules'))) return join(dir, 'node_modules');
    if (dirname(dir) === dir) return join(root, 'node_modules');
  }
}

/** Declared @wildshard/* aliases that resolve outside the installed store. */
export function unpinnedLinks(root) {
  const pkg = json(join(root, 'package.json'));
  if (pkg === undefined) return [];
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })
    .filter((name) => name.startsWith('@wildshard/'));
  const self = realOrUndefined(root);
  const modules = modulesDir(root);
  const virtualStoreDir = json(join(modules, '.modules.yaml'))?.virtualStoreDir;
  const store = typeof virtualStoreDir === 'string' ? realOrUndefined(resolve(modules, virtualStoreDir)) : undefined;
  const installed = (path) => store === undefined ? path.includes(`${sep}node_modules${sep}`) : path.startsWith(store + sep);
  return names.flatMap((name) => {
    const resolved = realOrUndefined(join(modules, name));
    if (resolved === undefined || name === pkg.name || resolved === self || installed(resolved)) return [];
    return [{ name, resolved }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The checkout's local-link receipt: { path, lane, reason, expires, links } or { path, problem }. */
export function linkReceipt(root, now = Date.now()) {
  let path;
  try {
    path = git(['rev-parse', '--path-format=absolute', '--git-path', RECEIPT], { cwd: root }).trim();
  } catch {
    return { path: `.git/${RECEIPT}`, problem: 'missing' };
  }
  if (!existsSync(path)) return { path, problem: 'missing' };
  const body = json(path);
  if (body === undefined || typeof body !== 'object' || body === null) return { path, problem: 'not JSON' };
  if (typeof body.lane !== 'string' || body.lane.trim() === '') return { path, problem: 'no lane named' };
  if (typeof body.reason !== 'string' || body.reason.trim() === '') return { path, problem: 'no reason given' };
  const expires = Date.parse(body.expires);
  if (Number.isNaN(expires)) return { path, problem: 'expires is not a date' };
  if (expires <= now) return { path, problem: `expired at ${body.expires}` };
  if (expires - now > MAX_AHEAD) return { path, problem: 'expires more than 24 h ahead' };
  const links = body.links;
  if (typeof links !== 'object' || links === null || Object.keys(links).length === 0
    || !Object.values(links).every((target) => typeof target === 'string')) {
    return { path, problem: 'no links named' };
  }
  return { path, lane: body.lane, reason: body.reason, expires: body.expires, links };
}

/** Why the receipt does not cover these links for this lane, or undefined when it does. */
function uncovered(receipt, links, lane) {
  if (receipt.problem !== undefined) return receipt.problem === 'missing' ? 'missing' : `ignored: ${receipt.problem}`;
  const stray = links.find(({ name, resolved }) => receipt.links[name] === undefined || realOrUndefined(receipt.links[name]) !== resolved);
  if (stray !== undefined) return `ignored: it does not name ${stray.name} -> ${stray.resolved}`;
  if (lane === 'push' && process.env.WS_LANE_NAME !== receipt.lane) {
    return `held by ${receipt.lane}: only WS_LANE_NAME=${receipt.lane} may push from this linked checkout`;
  }
  return undefined;
}

/** Print the verdict for a lane; returns false when the lane must stop. */
export function guardPinnedLinks(root, lane) {
  const links = unpinnedLinks(root);
  if (links.length === 0) return true;
  const lines = links.map(({ name, resolved }) => `    node_modules/${name} resolves to a live checkout: ${resolved}`);
  const receipt = linkReceipt(root);
  const why = uncovered(receipt, links, lane);
  if (why === undefined) {
    console.error(`  !! ${lane}: unpinned links allowed by the local-link receipt from ${receipt.lane} until ${receipt.expires} (${receipt.reason}):`);
    console.error(lines.join('\n'));
    return true;
  }
  const verdict = lane === 'push' ? 'X push blocked' : `!! ${lane} warning`;
  console.error(`\n  ${verdict}: local checks are not testing the pinned install CI uses.`);
  console.error(lines.join('\n'));
  console.error('    They run whatever another lane has half-edited there.');
  console.error('    Restore the pin, from repo-kit: node src/cli/main.ts local pinned --consumer <repo> --production-live <tag>');
  console.error('    (no repo-kit at hand: pnpm install --frozen-lockfile --prefer-offline --force here).');
  if (why !== 'missing') console.error(`    The local-link receipt ${why} (${receipt.path}).`);
  console.error(`    Linked on purpose? Write ${receipt.path}`);
  console.error(`    ${SHAPE}\n`);
  return lane !== 'push';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  process.exit(guardPinnedLinks(root, 'push') ? 0 : 1);
}
