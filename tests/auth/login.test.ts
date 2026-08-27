// tests/auth/login.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn()
const signInWithPassword = vi.fn()
const rpc = vi.fn()
const issueAndSendCode = vi.fn().mockResolvedValue({ sent: true })

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { signInWithPassword, getUser: async () => ({ data: { user: { email: 'a@b.c' } } }) }, rpc }),
}))
vi.mock('@/lib/auth/device', () => ({ getDeviceSecret: async () => 'known-secret' }))
vi.mock('@/lib/auth/codes', () => ({ issueAndSendCode }))

beforeEach(() => { redirect.mockClear(); rpc.mockClear(); issueAndSendCode.mockClear() })

describe('signIn', () => {
  it('goes straight to the app when the device is trusted', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ data: true, error: null })
    const { signIn } = await import('@/app/(auth)/login/actions')
    const fd = new FormData(); fd.set('email', 'a@b.c'); fd.set('password', 'x'.repeat(12))
    await signIn(null, fd)
    expect(redirect).toHaveBeenCalledWith('/')
    expect(issueAndSendCode).not.toHaveBeenCalled()
  })

  it('challenges when the device is not trusted', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ data: false, error: null })
    const { signIn } = await import('@/app/(auth)/login/actions')
    const fd = new FormData(); fd.set('email', 'a@b.c'); fd.set('password', 'x'.repeat(12))
    await signIn(null, fd)
    expect(issueAndSendCode).toHaveBeenCalledWith('device_challenge', 'a@b.c', expect.anything())
    expect(redirect).toHaveBeenCalledWith('/challenge')
  })

  it('returns one indistinguishable error for any credential failure', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const { signIn } = await import('@/app/(auth)/login/actions')
    const fd = new FormData(); fd.set('email', 'a@b.c'); fd.set('password', 'x'.repeat(12))
    expect(await signIn(null, fd)).toEqual({ error: 'invalid_credentials' })
  })
})
