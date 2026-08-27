import '@testing-library/jest-dom/vitest'

// Vitest does not auto-load .env.local into process.env the way Next.js does.
// Load it here (optional — absent in CI, where env vars are injected directly)
// so Node-side tests (e.g. tests/db/*) can read SUPABASE_DB_URL and friends.
try {
  process.loadEnvFile('.env.local')
} catch {
  // no .env.local present — fall back to whatever process.env already has
}
