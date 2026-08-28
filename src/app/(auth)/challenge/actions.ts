'use server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createServerSupabase } from '@/lib/supabase/server'
import { verifyCode } from '@/lib/auth/codes'
import { ensureDeviceSecret } from '@/lib/auth/device'
import { requireSession } from '@/lib/auth/guards'

const TRUST_DAYS = 30

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
