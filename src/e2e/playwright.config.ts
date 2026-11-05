import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

import type { PlaywrightTestConfig } from '@playwright/test'

// A port apart from the default 4404, so e2e runs beside a live `www.wildshard.io serve`.
const E2E_PORT = 4504
const BASE_URL = `http://127.0.0.1:${String(E2E_PORT)}`

const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  // Beside this config, not in the cwd (the repo root).
  outputDir: fileURLToPath(new URL('test-results', import.meta.url)),
  forbidOnly: process.env['CI'] !== undefined,
  reporter: process.env['CI'] === undefined ? 'list' : 'github',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && node src/cli/main.ts serve --port ${String(E2E_PORT)}`,
    // The package root (the repo root), where package.json lives.
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

export default config
