# Chromium without keychain prompts

Every Chromium launch imports and spreads KEYCHAIN_ARGS from
scripts/chromium-keychain.mjs. This explicitly selects the mock keychain
and basic password store, including raw executable launches. Playwright
default arguments remain enabled. The cheap source inventory runs in
pnpm check even when this repo currently has no browser launcher.

The matching helper and check belong in the K1 repo-kit migration too.

The follow-up audit adds raw shell binaries and namespace, bracket and
require aliases to the guard. Literal examples and regular-expression
exec calls stay separate from actual child-process calls. Each launch
is checked independently, including a second bare start in a safe file.
