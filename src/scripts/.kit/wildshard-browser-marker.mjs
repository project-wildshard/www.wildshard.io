import { AGENT_HEADER, agentUserAgent } from './wildshard-agent-requests.mjs';

const browsers = new WeakSet();
const engines = new WeakSet();

/** @template {import('playwright').BrowserContextOptions} Options @param {Options} [options] */
function markedContext(options) {
  const headers = options?.extraHTTPHeaders;
  return {
    ...options,
    ...(headers === undefined ? {} : {
      extraHTTPHeaders: Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== AGENT_HEADER)),
    }),
    ...(options?.userAgent === undefined ? {} : { userAgent: agentUserAgent(options.userAgent) }),
  };
}

/** Keep the engine's default network UA when the caller did not specify a device.
 * The app reads this suffix and carries its actor marker to the room.
 * @template {import('playwright').BrowserContext | import('playwright').Page} Target
 * @param {Target} target @param {string | undefined} userAgent @returns {Promise<Target>}
 */
async function markDefaultUA(target, userAgent) {
  if (userAgent === undefined) {
    await target.addInitScript((suffix) => {
      const base = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${base} ${suffix}` });
    }, agentUserAgent(''));
  }
  return target;
}

/** @param {import('playwright').Browser} browser */
function markedBrowser(browser) {
  if (browsers.has(browser)) return browser;
  browsers.add(browser);
  const context = browser.newContext.bind(browser), page = browser.newPage.bind(browser);
  browser.newContext = async options => markDefaultUA(await context(markedContext(options)), options?.userAgent);
  browser.newPage = async options => markDefaultUA(await page(markedContext(options)), options?.userAgent);
  return browser;
}

/** @param {object} playwright */
export function installBrowserActorMarker(playwright) {
  for (const name of ['chromium', 'webkit', 'firefox']) {
    const engine = /** @type {import('playwright').BrowserType|undefined} */ (Reflect.get(playwright, name));
    if (engine === undefined || engines.has(engine)) continue;
    engines.add(engine);
    for (const method of ['launch', 'connect', 'connectOverCDP']) {
      const open = Reflect.get(engine, method);
      if (typeof open !== 'function') continue;
      /** @param {...unknown} args */
      const launch = async (...args) => markedBrowser(await Reflect.apply(open, engine, args));
      Reflect.set(engine, method, launch);
    }
    if (typeof engine.launchPersistentContext === 'function') {
      const persistent = engine.launchPersistentContext.bind(engine);
      engine.launchPersistentContext = async (dir, options) => markDefaultUA(await persistent(dir, markedContext(options)), options?.userAgent);
    }
  }
}
