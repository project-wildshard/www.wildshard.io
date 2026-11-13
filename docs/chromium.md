# Chromium without macOS keychain dialogs or sound

Every Chromium launch passes `--use-mock-keychain`,
`--password-store=basic` and `--mute-audio` (Jake, 2026-11-13: "headless
chromium with volume off"). WebKit has no mute flag. Import `KEYCHAIN_ARGS` from
`scripts/chromium-keychain.mjs` and spread it into Playwright launch,
persistent-context and launch-server arguments, and raw executable
arguments. Retain Playwright default arguments. Never use
`ignoreDefaultArgs`.

```js
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const browser = await chromium.launch({ args: [...KEYCHAIN_ARGS] });
```

Connections must belong to a safely launched Chromium process. When the
launcher lives in another file, verify `Browser.getBrowserCommandLine`
against `KEYCHAIN_ARGS` before using the connected browser.

Run `node --test test/tooling/chrome-keychain.test.mjs`. The dependency-free
source guard inspects each launch and child-process API, including
executable aliases, raw paths, namespace and bracket calls. The template
CI runs it. Keep this command in the consumer check script too.

These are plain Node tooling files outside the typed app project. Register
their exact paths in that project's existing plain-script lint scope:
`scripts/chromium-keychain*` and
`test/tooling/chrome-keychain.test.mjs`. Syntax and the source-inventory
test run directly with Node; app lint rules remain unchanged.

K1 carries this document, both helpers, the declaration, the check and its
CI step into project-wildshard/repo-kit with their history.
