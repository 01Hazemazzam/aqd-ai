// tests/auth/google-button.test.tsx
//
// GoTrue rejects an unconfigured provider on its own origin, before the
// request ever reaches /auth/callback (confirmed live -- see
// oauth-callback.test.ts's comment and README's Sub-project 5 section). This
// covers the fallback that catches it client-side instead: no
// NEXT_PUBLIC_GOOGLE_CLIENT_ID means the button shows the "isn't configured
// yet" message and never calls signInWithOAuth at all.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const signInWithOAuth = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabase: () => ({ auth: { signInWithOAuth } }),
}))

beforeEach(() => {
  signInWithOAuth.mockClear()
  vi.unstubAllEnvs()
})

describe('GoogleButton', () => {
  it('shows the not-configured message and never calls signInWithOAuth when no client id is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '')
    const { GoogleButton } = await import('@/components/auth/google-button')
    render(<GoogleButton label="Continue with Google" notConfiguredLabel="Not configured yet." />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(await screen.findByText('Not configured yet.')).toBeInTheDocument()
    expect(signInWithOAuth).not.toHaveBeenCalled()
  })

  it('calls signInWithOAuth with the callback redirect when a client id is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'real-client-id')
    vi.resetModules()
    const { GoogleButton } = await import('@/components/auth/google-button')
    render(<GoogleButton label="Continue with Google" notConfiguredLabel="Not configured yet." />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    expect(screen.queryByText('Not configured yet.')).not.toBeInTheDocument()
  })
})
