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

// Port 3000 is Next's default, and the plan's own config targets it -- but
// on this machine it's routinely held by an unrelated project running in a
// different concurrent session. With reuseExistingServer: true, whatever is
// already listening on the configured port gets silently reused instead of
// failing loudly, so a wrong port here doesn't error, it corrupts results
// (axe/screenshots captured against someone else's app). Remapped to 3002,
// a free port on this machine, the same way Supabase's own ports were
// remapped for a local port conflict -- a config-only, easily-reverted local
// dev choice, not a change to the app itself.
const PORT = 3002

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'on-first-retry' },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
