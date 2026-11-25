// MT3: the operator protocol shared with engine's actorMarkers.json.
// oxlint-disable-next-line import/no-nodejs-modules -- These probes run in Node.
import { env } from 'node:process';

const AGENT_HEADER = 'x-wildshard-agent';
const TOKEN = 'WildshardAgent/1';
const LANE = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;

function agentLane() {
  /** @type {unknown} */
  const environment = env;
  const lane = typeof environment === 'object' && environment !== null && 'WS_LANE_NAME' in environment
    ? environment.WS_LANE_NAME
    : undefined;
  return typeof lane === 'string' && LANE.test(lane) ? lane : '1';
}

/** @param {string} base */
function agentUserAgent(base) {
  if (base.split(/\s+/u).includes(TOKEN)) {
    return base;
  }
  const lane = agentLane();
  const marker = lane === '1' ? TOKEN : `${TOKEN} (${lane})`;
  return `${base.trim()} ${marker}`.trim();
}

/** @param {string} input */
function gameAddress(input) {
  if (!URL.canParse(input)) {
    return false;
  }
  const host = new URL(input).hostname;
  return host === 'wildshard.io' || host.endsWith('.wildshard.io') || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** @param {typeof fetch} read @returns {typeof fetch} */
function markedFetch(read) {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Preserve the platform Fetch signature.
  return async (input, options) => {
    const request = input instanceof Request ? input : undefined;
    const address = request?.url ?? (input instanceof URL ? input.href : input);
    if (typeof address !== 'string' || !gameAddress(address)) {
      return await read(input, options);
    }
    const headers = new Headers(options?.headers ?? request?.headers);
    headers.set(AGENT_HEADER, agentLane());
    headers.set('user-agent', agentUserAgent(headers.get('user-agent') ?? 'node'));
    return await read(input, { ...options, headers });
  };
}

/** @type {typeof fetch} */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Preserve the platform Fetch signature.
const agentFetch = async (input, options) => await markedFetch(globalThis.fetch)(input, options);

export { AGENT_HEADER, agentFetch, agentUserAgent, markedFetch };
