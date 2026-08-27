// tests/auth/guard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn(() => { throw new Error('REDIRECT') })
let user: Record<string, unknown> | null = { id: 'u1', email_confirmed_at: '2026-01-01' }
let deviceTrusted = true

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, cache: (fn: unknown) => fn }
})
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async () => ({ data: deviceTrusted, error: null }),
  }),
}))
vi.mock('@/lib/auth/device', () => ({ getDeviceSecret: async () => 'secret' }))

beforeEach(() => { redirect.mockClear(); vi.resetModules() })

describe('requireVerified', () => {
  it('allows a confirmed user on a trusted device', async () => {
    user = { id: 'u1', email_confirmed_at: '2026-01-01' }; deviceTrusted = true
    const { requireVerified } = await import('@/lib/auth/guards')
    await expect(requireVerified()).resolves.toMatchObject({ id: 'u1' })
  })

  it('sends an unconfirmed user to verify', async () => {
    user = { id: 'u1', email_confirmed_at: null }; deviceTrusted = true
    const { requireVerified } = await import('@/lib/auth/guards')
    await expect(requireVerified()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/verify')
  })

  it('sends an untrusted device to the challenge', async () => {
    user = { id: 'u1', email_confirmed_at: '2026-01-01' }; deviceTrusted = false
    const { requireVerified } = await import('@/lib/auth/guards')
    await expect(requireVerified()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/challenge')
  })

  it('sends a signed-out visitor to login', async () => {
    user = null
    const { requireVerified } = await import('@/lib/auth/guards')
    await expect(requireVerified()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})
