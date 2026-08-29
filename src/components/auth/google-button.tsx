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
      <Button type="button" variant="secondary" onClick={handleClick} className="w-full">
        {label}
      </Button>
      {notConfigured && <p role="status" className="mt-2 text-xs text-ink-dim">{notConfiguredLabel}</p>}
    </div>
  )
}
