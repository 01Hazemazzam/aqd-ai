'use server'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { headers } from 'next/headers'
import { createServerSupabase } from '@/lib/supabase/server'
import { verifyCode, issueAndSendCode } from '@/lib/auth/codes'
import { ensureDeviceSecret } from '@/lib/auth/device'
import type { Locale } from '@/lib/i18n/config'

const TRUST_DAYS = 30

export async function submitVerification(_prev: unknown, formData: FormData) {
  const code = String(formData.get('code') ?? '')
  const result = await verifyCode(code, 'signup_verify')
  if (!result.ok) return { error: result.code }

  // Verifying at signup also trusts the device it happened on.
  const supabase = await createServerSupabase()
  const secret = await ensureDeviceSecret(TRUST_DAYS)
  const h = await headers()
  await supabase.rpc('trust_device', {
    p_secret: secret,
    p_user_agent: h.get('user-agent') ?? 'unknown',
    p_days: TRUST_DAYS,
  })

  redirect('/onboarding')
}

export async function resendCode() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'unknown' as const }
  const locale = (await getLocale()) as Locale
  const { sent, error } = await issueAndSendCode('signup_verify', user.email, locale)
  return sent ? {} : { error: error ?? ('unknown' as const) }
}
