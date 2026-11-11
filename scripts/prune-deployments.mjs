// Deletes superseded Vercel deployments. Shared by every org repo that deploys to Vercel (meta VERCEL-SPEND-PLAN);
// repo-kit holds the source and each repo carries a copy, with scripts/vercel-prune-check.mjs in its `pnpm check`.
//
// Every deployment is a full copy (up to ~3 GB) billed as Deployment Storage at $0.10 per GB-month, and Vercel's
// 1-day retention policy does not clear them: wildshard-admin still held 30 production deployments back to 10-13 under
// it on 2026-11-11. Without this step storage only grows: singleplayer's J189 rewrite (448ef9a) dropped it on 11-07 and
// storage went from 23 GB to 93 GB in three days. Jake keeps the last five builds; rollback is a deploy forward (J179).
//
//   node scripts/prune-deployments.mjs [--project <name|id>] [--keep 5] [--staged-grace-hours 1] [--dry-run]
//
// Token: VERCEL_BUILD_TOKEN or VERCEL_TOKEN. Team: VERCEL_ORG_ID (default raynos-projects). Project: --project or
// VERCEL_PROJECT_ID. A failure prints a ::warning:: and exits 1; workflows run it with continue-on-error.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const KEEP_PROMOTED = 5;
/** A release promotes its stage about 20 minutes after the upload, and a deleted stage only falls back to a fresh deploy. */
export const STAGED_GRACE_MS = 60 * 60 * 1000;
const TEAM = 'team_HPUh311dFa6AoKlBNtS9Oiph';

/** @typedef {{uid: string, created: number, state?: string, target?: string|null, readySubstate?: string}} Deployment */

/** Live, aliased, the newest promoted and young stages stay; an unknown substate is never deleted.
 * @param {readonly Deployment[]} deployments
 * @param {{liveId: string, aliased: ReadonlySet<string>, now: number, keep?: number, graceMs?: number}} context
 * @returns {Deployment[]} */
export function prunable(deployments, { liveId, aliased, now, keep = KEEP_PROMOTED, graceMs = STAGED_GRACE_MS }) {
  const ready = deployments.filter((deployment) => deployment.state === 'READY' && deployment.target === 'production');
  const newest = [...ready].sort((a, b) => b.created - a.created);
  const kept = new Set(newest.filter((deployment) => deployment.readySubstate === 'PROMOTED')
    .slice(0, keep).map((deployment) => deployment.uid));
  return newest.filter((deployment) => deployment.uid !== liveId && !aliased.has(deployment.uid) && !kept.has(deployment.uid)
    && (deployment.readySubstate === 'PROMOTED'
      || (deployment.readySubstate === 'STAGED' && now - deployment.created > graceMs)));
}

/** Vercel answered, and the answer will not change on a retry. */
class RefusedError extends Error {
  name = 'RefusedError';
}

/** A timeout, a 429 or a 5xx is retried; a run that gives up names the request, so the warning says what to look at.
 * @template T @param {string} label @param {() => Promise<T>} call
 * @param {(milliseconds: number) => Promise<void>} [pause] @returns {Promise<T>} */
export async function withRetries(label, call, pause = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); })) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof RefusedError || attempt >= 4) throw new Error(`${label}: ${reason} (attempt ${attempt})`, { cause: error });
      console.log(`${label}: ${reason}; retrying`);
      await pause(attempt * 5_000);
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, keep: { type: 'string' }, 'staged-grace-hours': { type: 'string' }, 'dry-run': { type: 'boolean' } } });
  // An env var set to "" falls through to the next, as with a secret that isn't set.
  const token = [process.env.VERCEL_BUILD_TOKEN, process.env.VERCEL_TOKEN].find(Boolean);
  if (!token) throw new Error('VERCEL_BUILD_TOKEN or VERCEL_TOKEN is required');
  const team = [process.env.VERCEL_ORG_ID, TEAM].find(Boolean);
  const project = [values.project, process.env.VERCEL_PROJECT_ID].find(Boolean);
  if (!project) throw new Error('--project or VERCEL_PROJECT_ID is required');
  const keep = values.keep === undefined ? KEEP_PROMOTED : Number(values.keep);
  const graceMs = values['staged-grace-hours'] === undefined ? STAGED_GRACE_MS : Number(values['staged-grace-hours']) * 3_600_000;
  if (!Number.isInteger(keep) || keep < 1 || !(graceMs >= 0)) throw new Error('--keep is a whole number of at least 1, the grace a number of hours');
  /** @param {string} path @param {string} [method] @returns {Promise<any>} */
  const api = (path, method = 'GET') => withRetries(`${method} ${path}`, async () => {
    const response = await fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${team}`,
      { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    if (response.ok) return response.json();
    if (method === 'DELETE' && response.status === 404) return undefined; // A parallel run's prune got there first.
    const message = `HTTP ${response.status}`;
    throw response.status === 429 || response.status >= 500 ? new Error(message) : new RefusedError(message);
  });
  /** @param {string} path @param {string} key @returns {Promise<any[]>} */
  const pages = async (path, key) => {
    const rows = [];
    for (let until; ;) {
      const page = await api(`${path}${until ? `&until=${until}` : ''}`);
      rows.push(...page[key]);
      until = page.pagination?.next;
      if (!until || page[key].length === 0) return rows;
    }
  };
  const { id, targets } = await api(`/v9/projects/${encodeURIComponent(project)}`);
  const deployments = await pages(`/v6/deployments?projectId=${id}&limit=100`, 'deployments');
  const aliases = await pages(`/v4/aliases?projectId=${id}&limit=100`, 'aliases');
  const liveId = targets?.production?.id;
  if (!deployments.some((deployment) => deployment.uid === liveId)) throw new Error('The live deployment is not in the listing');
  const stale = prunable(deployments, { liveId, aliased: new Set(aliases.map((alias) => alias.deploymentId)), now: Date.now(), keep, graceMs });
  if (!values['dry-run']) for (const deployment of stale) await api(`/v13/deployments/${deployment.uid}`, 'DELETE');
  console.log(`${values['dry-run'] ? 'Would prune' : 'Pruned'} ${stale.length} of ${deployments.length} deployments of ${project}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.log(`::warning::Deployment prune failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
