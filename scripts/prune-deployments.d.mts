export const KEEP_PROMOTED: number;
export const STAGED_GRACE_MS: number;
export function withRetries<T>(label: string, call: () => Promise<T>, pause?: (milliseconds: number) => Promise<void>): Promise<T>;
export interface Deployment { uid: string; created: number; state?: string; target?: string | null; readySubstate?: string | undefined; }
export function prunable(deployments: readonly Deployment[], context: { liveId: string; aliased: ReadonlySet<string>; now: number; keep?: number; graceMs?: number }): Deployment[];
