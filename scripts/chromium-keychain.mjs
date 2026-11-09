// Every Chromium this repo starts passes these two (Jake, 2026-11-09). Without them Chrome for Testing asks the macOS
// keychain for "Chrome for Testing Safe Storage" and a dialog lands on the desktop at each launch. Playwright adds them
// by default, but a raw `spawn` of the executable skips its defaults, so every launch site spreads them explicitly and
// test/tooling/chrome-keychain.test.mjs refuses a launch file that does not.
export const KEYCHAIN_ARGS = Object.freeze(['--use-mock-keychain', '--password-store=basic']);
