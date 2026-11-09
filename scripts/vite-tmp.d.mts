/** A sweep's clock and report-only switch. */
export interface SweepOptions { now?: number; dryRun?: boolean }
/** Age, byte cap, clock and report-only switch for the compile cache. */
export interface CompileCacheOptions extends SweepOptions { capBytes?: number; maxAgeMs?: number }
/** What one compile cache prune found and removed. */
export interface CompileCacheReport { files: number; beforeBytes: number; removed: number; keptBytes: number }
/** Where the run folder lives (default: the repo holding scripts/) and which janitor script a sweep starts. */
export interface TemporaryRunOptions { root?: string; janitor?: string }
/** Milliseconds since a path changed; a folder another process has just removed counts as new. */
export function age(path: string, now: number): number;
/** Remove tmp/vitest/<pid> of dead processes idle for an hour; returns how many. */
export function sweepVitestRuns(root: string, options?: SweepOptions): number;
/** Remove 21-character Vitest folders (only client/ and ssr/ inside) idle for an hour from a system temp dir. */
export function sweepSystemTemp(directory: string, options?: SweepOptions): { removed: number; files: number };
/** Remove compile cache entries past a day, then the oldest until under the byte cap. */
export function pruneCompileCache(directory: string, options?: CompileCacheOptions): CompileCacheReport;
/** Point TMPDIR and NODE_COMPILE_CACHE at the run's own folder under the repo's tmp/ until cleanup(). */
export function temporaryRun(env?: NodeJS.ProcessEnv, options?: TemporaryRunOptions): { dir: string; cleanup: () => void };
/** The Vite/Vitest plugin that keeps a run's temp files under the repo's tmp/vitest/<pid>. */
export function viteTmpRoot(options?: TemporaryRunOptions): {
  name: string;
  configureVitest: (context: { vitest: { onClose: (listener: () => void) => void } }) => void;
};
