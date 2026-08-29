// tests/auth/oauth-callback.test.ts
//
// The Google OAuth callback route (src/app/auth/callback/route.ts) is
// login/actions.ts's signIn with a session already created by GoTrue instead
// of signInWithPassword -- same device-trust gate, same `login` event. This
// mirrors tests/auth/login.test.ts's mocking shape for that reason.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const exchangeCodeForSession = vi.fn()
const rpc = vi.fn()
const insert = vi.fn().mockResolvedValue({ error: null })
const issueAndSendCode = vi.fn().mockResolvedValue({ sent: true })
const getUser = vi.fn().mockResolvedValue({ data: { user: { email: 'a@b.c' } } })

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { exchangeCodeForSession, getUser },
    rpc,
    from: () => ({ insert }),
  }),
}))
vi.mock('@/lib/auth/device', () => ({ getDeviceSecret: async () => 'known-secret' }))
vi.mock('@/lib/auth/codes', () => ({ issueAndSendCode }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))

beforeEach(() => {
  exchangeCodeForSession.mockClear()
  rpc.mockClear()
  insert.mockClear()
  issueAndSendCode.mockClear()
  getUser.mockClear().mockResolvedValue({ data: { user: { email: 'a@b.c' } } })
})

function locationOf(res: Response) {
  return new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search
}

describe('GET /auth/callback', () => {
  it('redirects to /login?oauthError=1 when GoTrue reports an error, no code exchanged', async () => {
    const { GET } = await import('@/app/auth/callback/route')
    const res = await GET(new Request('http://localhost/auth/callback?error=access_denied'))
    expect(locationOf(res)).toBe('/login?oauthError=1')
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('redirects to /login?oauthError=1 when there is no code at all', async () => {
    const { GET } = await import('@/app/auth/callback/route')
    const res = await GET(new Request('http://localhost/auth/callback'))
    expect(locationOf(res)).toBe('/login?oauthError=1')
  })

  it('redirects to /login?oauthError=1 when the code exchange itself fails', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid grant' } })
    const { GET } = await import('@/app/auth/callback/route')
    const res = await GET(new Request('http://localhost/auth/callback?code=abc'))
    expect(locationOf(res)).toBe('/login?oauthError=1')
    expect(insert).not.toHaveBeenCalled()
  })

  it('goes straight to the app when the exchange succeeds and the device is trusted', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ data: true, error: null })
    const { GET } = await import('@/app/auth/callback/route')
    const res = await GET(new Request('http://localhost/auth/callback?code=abc'))
    expect(locationOf(res)).toBe('/')
    expect(insert).toHaveBeenCalledWith({ kind: 'login' })
    expect(issueAndSendCode).not.toHaveBeenCalled()
  })

  it('challenges when the exchange succeeds but the device is not trusted', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ data: false, error: null })
    const { GET } = await import('@/app/auth/callback/route')
    const res = await GET(new Request('http://localhost/auth/callback?code=abc'))
    expect(locationOf(res)).toBe('/challenge')
    expect(issueAndSendCode).toHaveBeenCalledWith('device_challenge', 'a@b.c', 'en')
  })
})
