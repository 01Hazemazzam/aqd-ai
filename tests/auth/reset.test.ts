// tests/auth/reset.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
const updateUser = vi.fn().mockResolvedValue({ error: null })
const verifyOtp = vi.fn().mockResolvedValue({ error: null })
const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
const getUser = vi.fn().mockResolvedValue({ data: { user: { email: 'a@b.c' } } })

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    rpc,
    auth: { updateUser, verifyOtp, resetPasswordForEmail, getUser },
  }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  rpc.mockClear(); updateUser.mockClear(); verifyOtp.mockClear(); resetPasswordForEmail.mockClear()
})

describe('requestReset', () => {
  it('reports success even for an address with no account', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'User not found' } })
    const { requestReset } = await import('@/app/(auth)/reset/actions')
    const fd = new FormData(); fd.set('email', 'ghost@nowhere.test')
    await expect(requestReset(null, fd)).resolves.toBeUndefined()
  })
})

describe('confirmReset', () => {
  it('revokes every trusted device after changing the password', async () => {
    const { confirmReset } = await import('@/app/(auth)/reset/actions')
    const fd = new FormData()
    fd.set('email', 'a@b.c')
    fd.set('code', '123456')
    fd.set('password', 'a-brand-new-password')
    await confirmReset(null, fd)

    expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.c', token: '123456', type: 'recovery' })
    expect(updateUser).toHaveBeenCalledWith({ password: 'a-brand-new-password' })
    expect(rpc).toHaveBeenCalledWith('revoke_all_devices')
  })

  it('does not change the password when the code is wrong', async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } })
    const { confirmReset } = await import('@/app/(auth)/reset/actions')
    const fd = new FormData()
    fd.set('email', 'a@b.c'); fd.set('code', '000000'); fd.set('password', 'whatever-long')
    const result = await confirmReset(null, fd)

    expect(result).toEqual({ error: 'code_incorrect' })
    expect(updateUser).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
