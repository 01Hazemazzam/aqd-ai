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
  if (error) return { error: toAuthErrorCode(error) }

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
