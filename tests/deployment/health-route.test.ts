// tests/deployment/health-route.test.ts
//
// The route exists so a daily cron keeps a free Supabase project from pausing
// after seven idle days -- the exact failure mode of a portfolio link that
// gets clicked once a fortnight. Two things have to hold: it must actually
// reach the database (a route that returns ok without querying keeps nothing
// awake), and it must not become an open door.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const limit = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ limit }) }) }),
}))

const { GET } = await import('@/app/api/health/route')

const request = (headers: Record<string, string> = {}) => new Request('https://example.test/api/health', { headers })

const ORIGINAL = { ...process.env }

beforeEach(() => {
  limit.mockReset()
  limit.mockResolvedValue({ error: null })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  delete process.env.CRON_SECRET
})

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('GET /api/health', () => {
  it('reports healthy only after the database answers', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(limit).toHaveBeenCalled()
  })

  // An empty result is the expected answer here -- `playbooks` grants SELECT
  // to authenticated only, and this route is anonymous. What matters is that
  // PostgREST had to ask Postgres to find that out.
  it('treats an empty result as healthy and an error as not', async () => {
    limit.mockResolvedValue({ error: { message: 'relation does not exist' } })

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, reason: 'database' })
  })

  it('reports unreachable rather than throwing when the fetch fails', async () => {
    limit.mockRejectedValue(new Error('ECONNREFUSED'))

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('says so instead of guessing when it has no configuration', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, reason: 'unconfigured' })
  })
})

describe('GET /api/health :: who may call it', () => {
  // Vercel sends this header on scheduled invocations. Checking it only when
  // the secret exists keeps local and preview deployments callable by hand.
  it('requires the cron secret once one is configured', async () => {
    process.env.CRON_SECRET = 's3cret'

    const refused = await GET(request())
    expect(refused.status).toBe(401)
    expect(limit).not.toHaveBeenCalled()

    const allowed = await GET(request({ authorization: 'Bearer s3cret' }))
    expect(allowed.status).toBe(200)
  })

  it('refuses a wrong secret rather than falling back to open', async () => {
    process.env.CRON_SECRET = 's3cret'

    const response = await GET(request({ authorization: 'Bearer wrong' }))

    expect(response.status).toBe(401)
    expect(limit).not.toHaveBeenCalled()
  })

  it('answers anyone when no secret is set, which is the local case', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
  })
})
