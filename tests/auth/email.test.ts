// tests/auth/email.test.ts
//
// User-reported "signup is not sending verification emails," with an
// explicit instruction that the dev-mode on-screen code does not count as
// verification. Root cause, confirmed by reading .env.local directly:
// RESEND_API_KEY is unset in this environment -- there is no email provider
// configured at all, so sendCodeEmail correctly takes its documented
// dev-mode fallback. That's an external blocker (no key available in this
// environment), not fixable by a code change. What IS verifiable without a
// real key: that the Resend SDK call itself is shaped correctly (right
// method, right payload fields, matching resend@6.24.0's CreateEmailOptions
// type) so a real key would actually work once added, and that a rejected
// send degrades to `false` rather than throwing and stranding the caller.
//
// A second, independent blocker worth surfacing even with a real key:
// EMAIL_FROM="Aqd <auth@example.com>" in .env.local uses example.com, a
// reserved documentation domain. Resend requires the sending domain to be
// verified via DNS in the account dashboard -- example.com can never be
// verified, so real delivery would still fail with an unverified-domain
// error until EMAIL_FROM points at a real, DNS-verified domain.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function MockResend() {
    return { emails: { send } }
  }),
}))

beforeEach(() => {
  send.mockReset()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('sendCodeEmail', () => {
  it('calls the real Resend SDK with the correct payload shape when a key is configured', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('EMAIL_FROM', 'Aqd <auth@example.com>')
    send.mockResolvedValue({ data: { id: 'email-1' }, error: null })

    const { sendCodeEmail } = await import('@/lib/auth/email')
    const ok = await sendCodeEmail('user@test.local', '482913', 'en')

    expect(ok).toBe(true)
    expect(send).toHaveBeenCalledWith({
      from: 'Aqd <auth@example.com>',
      to: 'user@test.local',
      subject: 'Your Aqd verification code',
      html: expect.stringContaining('482913'),
    })
  })

  it('returns false rather than throwing when Resend rejects the send, and logs the real reason', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('EMAIL_FROM', 'Aqd <auth@example.com>')
    send.mockRejectedValue(new Error('403: The example.com domain is not verified'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendCodeEmail } = await import('@/lib/auth/email')
    const ok = await sendCodeEmail('user@test.local', '482913', 'ar')

    expect(ok).toBe(false)
    // Previously swallowed entirely -- this is what would make an
    // EMAIL_FROM/domain-verification failure diagnosable once a real key is
    // configured, instead of a silent, untraceable non-delivery.
    expect(errorSpy).toHaveBeenCalledWith(
      '[sendCodeEmail] Resend send failed:',
      expect.stringContaining('domain is not verified'),
    )
    errorSpy.mockRestore()
  })

  it('never calls Resend at all when no key is configured -- matches this environment exactly', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const { sendCodeEmail } = await import('@/lib/auth/email')
    await sendCodeEmail('user@test.local', '482913', 'en')

    expect(send).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('482913'))
    consoleSpy.mockRestore()
  })
})
