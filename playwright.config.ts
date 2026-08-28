import { defineConfig, devices } from '@playwright/test'

// Playwright does not auto-load .env.local into process.env the way Next.js
// (for the webServer's `npm run dev`) or Vitest's tests/setup.ts do. Without
// this, e2e/auth.spec.ts's own pg.Client falls back to the stale default
// port (54322) instead of this stack's remapped 55322 and every DB-reading
// test fails with ECONNREFUSED, even though the app itself loads fine.
try {
  process.loadEnvFile('.env.local')
} catch {
  // no .env.local present -- fall back to whatever process.env already has
}

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
