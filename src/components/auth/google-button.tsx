'use client'
import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

// Live-verified this actually matters: with no client id configured, GoTrue
// rejects at its own /authorize endpoint with a raw `{"error_code":
// "validation_failed", ...}` JSON body on the Supabase origin -- the request
// never reaches /auth/callback at all, so that route's own oauthError
// handling can't help. Client ids aren't secret (only the OAuth secret is),
// so a NEXT_PUBLIC_ mirror of the same value lets the button catch this
// itself, matching the "click it, get a clear not-configured message,
// nothing crashes" pattern this codebase already uses for AI keys and RESEND.
const CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)

// A single-colour "G" mark in currentColor -- the app's buttons are
// otherwise entirely theme-token driven (see tests/token-audit.test.ts,
// which bans raw colour literals outside globals.css), and Google's own
// four-brand-colour mark would be the one saturated, non-adapting element on
// an otherwise restrained editorial palette. A monochrome mark reads as part
// of the same design system in both themes instead of an imported sticker.
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62zM9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.85.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18zM3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33zM9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  )
}

export function GoogleButton({ label, notConfiguredLabel }: { label: string; notConfiguredLabel: string }) {
  const [notConfigured, setNotConfigured] = useState(false)

  const handleClick = async () => {
    if (!CONFIGURED) {
      setNotConfigured(true)
      return
    }
    const supabase = createBrowserSupabase()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <div>
      <Button type="button" variant="secondary" icon={<GoogleGlyph />} onClick={handleClick} className="w-full">
        {label}
      </Button>
      {notConfigured && <p role="status" className="mt-2 text-xs text-ink-dim">{notConfiguredLabel}</p>}
    </div>
  )
}
