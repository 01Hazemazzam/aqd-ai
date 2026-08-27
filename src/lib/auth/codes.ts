import { createServerSupabase } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { sendCodeEmail } from './email'
import { toAuthErrorCode, type AuthResult } from './errors'
import type { Locale } from '@/lib/i18n/config'

export type CodePurpose = 'signup_verify' | 'device_challenge'

export async function issueAndSendCode(
  purpose: CodePurpose,
  email: string,
  locale: Locale,
): Promise<{ sent: boolean; error?: ReturnType<typeof toAuthErrorCode> }> {
  const supabase = await createServerSupabase()
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''

  const { data, error } = await supabase.rpc('issue_code', { p_purpose: purpose, p_ip: ip })
  if (error) return { sent: false, error: toAuthErrorCode(error) }

  const sent = await sendCodeEmail(email, data as string, locale)

  // A send failure must be visible rather than silent — the user still reaches
  // the verify screen, and this is how we know why their code never arrived.
  if (!sent) {
    await supabase.from('auth_events').insert({ kind: 'code_send_failed' })
  }

  return { sent }
}

export async function verifyCode(code: string, purpose: CodePurpose): Promise<AuthResult> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('verify_code', { p_code: code, p_purpose: purpose })
  if (error) return { ok: false, code: toAuthErrorCode(error) }

  // verify_code returns its verdict rather than raising, so the failure status
  // arrives in `data`, not `error`.
  return data === 'ok' ? { ok: true } : { ok: false, code: toAuthErrorCode({ message: String(data) }) }
}
