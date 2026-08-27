import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Vitest does not auto-load .env.local into process.env the way Next.js does.
// Load it here (optional — absent in CI, where env vars are injected directly)
// so Node-side tests (e.g. tests/db/*) can read SUPABASE_DB_URL and friends.
try {
  process.loadEnvFile('.env.local')
} catch {
  // no .env.local present — fall back to whatever process.env already has
}

// next-intl/server's package.json exports a "react-server"-conditioned build;
// Vite/Vitest resolve the client-side stub instead (which throws "not supported
// in Client Components" for every export), regardless of jsdom vs node test
// environment. Server actions/components that call getLocale()/getTranslations()
// etc. need a working stand-in to be testable at all. Tests that care about a
// specific locale can still override this with their own vi.mock() call.
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getMessages: async () => ({}),
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => {},
}))
