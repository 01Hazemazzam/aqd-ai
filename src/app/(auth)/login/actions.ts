'use server'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getDeviceSecret } from '@/lib/auth/device'
import { issueAndSendCode } from '@/lib/auth/codes'
import { toAuthErrorCode } from '@/lib/auth/errors'
import type { Locale } from '@/lib/i18n/config'

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // log_login_failed (security definer) bridges the same gap issue_code/
    // verify_code already bridge for login_codes: a failed attempt has no
    // session, so events_own_insert's `user_id = auth.uid()` RLS check can't
    // pass for a direct insert. It looks the user up internally and writes
    // nothing when no such user exists, so calling it here doesn't add a
    // second account-enumeration oracle alongside this action's own uniform
    // error response below.
    await supabase.rpc('log_login_failed', { p_email: email })
    return { error: toAuthErrorCode(error) }
  }

  await supabase.from('auth_events').insert({ kind: 'login' })

  const secret = await getDeviceSecret()
  const { data: trusted } = await supabase.rpc('is_device_trusted', { p_secret: secret ?? '' })
  if (trusted) {
    redirect('/')
    return
  }

  const locale = (await getLocale()) as Locale
  await issueAndSendCode('device_challenge', email, locale)
  redirect('/challenge')
}
