'use server'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { issueAndSendCode } from '@/lib/auth/codes'
import { toAuthErrorCode } from '@/lib/auth/errors'
import { validateSignup } from './validate'
import type { Locale } from '@/lib/i18n/config'

export async function signUp(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const issue = validateSignup(email, password)
  if (issue) return { error: issue }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) return { error: toAuthErrorCode(error) }

  const locale = (await getLocale()) as Locale
  const { sent } = await issueAndSendCode('signup_verify', email, locale)

  redirect(sent ? '/verify' : '/verify?send=failed')
}
