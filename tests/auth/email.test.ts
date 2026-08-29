// tests/auth/email.test.ts
//
// Originally written when RESEND_API_KEY was unset in this environment --
// confirmed then that the SDK call itself was shaped correctly and that a
// send failure degraded to `false` rather than throwing. Once a real key
// was configured and live-tested, a real bug surfaced that this file's own
// mocking had been hiding: the Resend SDK does NOT throw on an API-level
// failure (bad domain, rate limit, an invalid recipient) -- it resolves
// normally with `{ data: null, error }`. A real send to a sandbox-
// restricted recipient came back exactly this way, and the code -- and this
// test file -- only ever checked for a throw, so a genuine rejected send
// was being reported as sent. Fixed in email.ts to check `error` on the
// resolved result; the tests below now mock the SDK's real contract instead
// of a reject, plus a separate case for a genuine network-level throw
// (still handled, now correctly a secondary path rather than the only one).
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

  it('returns false when Resend resolves with an error (its real failure contract, not a throw), and logs it', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('EMAIL_FROM', 'Aqd <onboarding@resend.dev>')
    // The exact shape of a real, live Resend response for a sandbox-domain
    // send to a non-account-owner recipient -- confirmed against the actual
    // API, not guessed.
    send.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        message: 'You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.',
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendCodeEmail } = await import('@/lib/auth/email')
    const ok = await sendCodeEmail('someone-else@test.local', '482913', 'ar')

    expect(ok).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith(
      '[sendCodeEmail] Resend rejected the send:',
      expect.stringContaining('You can only send testing emails to your own email address'),
    )
    errorSpy.mockRestore()
  })

  it('returns false rather than throwing on a genuine network-level exception', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('EMAIL_FROM', 'Aqd <onboarding@resend.dev>')
    send.mockRejectedValue(new Error('fetch failed: ECONNRESET'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendCodeEmail } = await import('@/lib/auth/email')
    const ok = await sendCodeEmail('user@test.local', '482913', 'en')

    expect(ok).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('[sendCodeEmail] Resend send failed:', expect.stringContaining('ECONNRESET'))
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

describe('sendInviteEmail', () => {
  it('returns false when Resend resolves with an error, same non-throwing contract as sendCodeEmail', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('EMAIL_FROM', 'Aqd <onboarding@resend.dev>')
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'You can only send testing emails to your own email address (owner@example.com).' },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendInviteEmail } = await import('@/lib/auth/email')
    const ok = await sendInviteEmail('teammate@test.local', 'Acme Legal', 'https://app/onboarding?invite=abc', 'en')

    expect(ok).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith(
      '[sendInviteEmail] Resend rejected the send:',
      expect.stringContaining('You can only send testing emails to your own email address'),
    )
    errorSpy.mockRestore()
  })
})
