import { availableParallelism } from 'node:os';
import { delimiter, join } from 'node:path';

/** A local gate leaves at least three quarters of the available cores free. */
export function gateWorkers(env = process.env, cores = availableParallelism()) {
  const requested = env.WS_GATE_WORKERS;
  if (requested === undefined) return Math.max(1, Math.floor(cores / 4));
  const workers = Number(requested);
  if (!/^[1-9]\d*$/u.test(requested) || !Number.isSafeInteger(workers)) {
    throw new Error('WS_GATE_WORKERS must be a positive integer');
  }
  return workers;
}

/** Apply to gate children only. Node disallows --test-concurrency in NODE_OPTIONS. */
export function gateTestEnvironment(env, vitestCeiling = Infinity) {
  const workers = gateWorkers(env);
  const bin = join(import.meta.dirname, 'gate-bin');
  return {
    ...env,
    PATH: [bin, ...new Set((env.PATH ?? '').split(delimiter).filter(path => path && path !== bin))].join(delimiter),
    WS_GATE_WORKERS: String(workers),
    WS_GATE_VITEST_WORKERS: String(Math.min(workers, vitestCeiling)),
    WS_GATE_NODE: process.execPath,
  };
}
