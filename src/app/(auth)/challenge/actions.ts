'use server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { verifyCode, issueAndSendCode } from '@/lib/auth/codes'
import { ensureDeviceSecret } from '@/lib/auth/device'
import { requireSession } from '@/lib/auth/guards'
import type { Locale } from '@/lib/i18n/config'

const TRUST_DAYS = 30

// The challenge screen had no way to request a fresh code; a mistyped or
// expired one left the only recourse as starting login over. Mirrors verify's
// resendCode: (prevState, formData) so useActionState can drive it.
export async function resendChallenge(_prev: unknown, _formData: FormData) {
  await requireSession()

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'unknown' as const }
  const locale = (await getLocale()) as Locale
  const { sent, error } = await issueAndSendCode('device_challenge', user.email, locale)
  return sent ? { sent: true as const } : { error: error ?? ('unknown' as const) }
}

export async function submitChallenge(_prev: unknown, formData: FormData) {
  // The route layout already gates this screen; this second check covers the
  // session expiring between page load and submit. Without it verify_code's
  // `not_authenticated` comes back as an unmapped error and renders as
  // "that code isn't right", which is untrue and unactionable.
  await requireSession()

  const code = String(formData.get('code') ?? '')
  const trust = formData.get('trust') === 'on'

  const result = await verifyCode(code, 'device_challenge')
  if (!result.ok) return { error: result.code }

  // Unchecked, the cookie is session-scoped and the device row expires with it,
  // so the next login challenges again.
  const secret = await ensureDeviceSecret(trust ? TRUST_DAYS : undefined)
  const supabase = await createServerSupabase()
  const h = await headers()
  await supabase.rpc('trust_device', {
    p_secret: secret,
    p_user_agent: h.get('user-agent') ?? 'unknown',
    p_days: trust ? TRUST_DAYS : 1,
  })

  redirect('/')
}
