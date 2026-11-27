import { spawnSync } from 'node:child_process';
import { availableParallelism, constants } from 'node:os';
import { pathToFileURL } from 'node:url';

const OPERANDS = new Set([
  '-C', '--conditions', '-r', '--require', '--import', '--loader',
  '--experimental-loader', '--experimental-config-file', '--env-file', '--env-file-if-exists',
  '--test-concurrency', '--test-name-pattern', '--test-skip-pattern', '--test-reporter',
  '--test-reporter-destination', '--test-timeout', '--test-shard', '--test-isolation',
]);

function entry(args) {
  let test = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--test') test = true;
    if (OPERANDS.has(arg)) {
      index++;
    } else if (/^(?:--|-e|--eval|-p|--print)(?:=|$)/u.test(arg)) {
      break;
    } else if (!arg.startsWith('-')) {
      return { index, test, vitest: /(?:^|\/)vitest(?:\.mjs|\/dist\/cli\.js)$/u.test(arg) };
    }
  }
  return { index: args.length, test, vitest: false };
}

/** Clamp valid worker flags while letting the runner report malformed flags. */
function bounded(args, names, cap, flag, percent = false) {
  const result = [];
  let found = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const [name, inline] = arg.split('=', 2);
    if (!names.includes(name)) {
      result.push(arg);
      continue;
    }
    found = true;
    const value = inline ?? args[index + 1];
    if (value === undefined || !/^[1-9]\d*%?$/u.test(value) || (!percent && value.endsWith('%'))) {
      result.push(arg);
      continue;
    }
    const workers = value.endsWith('%')
      ? Math.max(1, Math.floor(Number(value.slice(0, -1)) * availableParallelism() / 100))
      : Number(value);
    result.push(`${name}=${Math.min(cap, workers)}`);
    if (inline === undefined) index++;
  }
  return found ? result : [`${flag}=${cap}`, ...result];
}

export function gateTestCommand(args, env) {
  const { index, test, vitest } = entry(args);
  if (test) {
    const flag = '--test-concurrency';
    return { args: [...bounded(args.slice(0, index), [flag], Number(env.WS_GATE_WORKERS), flag), ...args.slice(index)], env };
  }
  if (!vitest) return { args, env };
  const flag = '--maxWorkers';
  const { VITEST_MAX_WORKERS: requested, ...testEnv } = env;
  const workers = Math.min(Number(env.WS_GATE_VITEST_WORKERS), /^[1-9]\d*$/u.test(requested ?? '') ? Number(requested) : Infinity);
  const tail = args.slice(index + 1);
  const border = tail.indexOf('--');
  const flags = border === -1 ? tail : tail.slice(0, border);
  const rest = border === -1 ? [] : tail.slice(border);
  return { args: [...args.slice(0, index + 1), ...bounded(flags, [flag, '--max-workers'], workers, flag, true), ...rest], env: testEnv };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = gateTestCommand(process.argv.slice(2), process.env);
  if (process.execve) process.execve(process.execPath, [process.execPath, ...command.args], command.env);
  const result = spawnSync(process.execPath, command.args, { env: command.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? (128 + (constants.signals[result.signal] ?? 1));
}
