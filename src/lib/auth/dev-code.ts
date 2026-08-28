import { createServerSupabase } from '@/lib/supabase/server'
import type { CodePurpose } from './codes'

/**
 * DEV ONLY. With no email provider configured locally there is no way to
 * receive a code, which makes the verify/challenge screens impossible to get
 * past by hand. This returns the caller's own current live code so the dev
 * screens can show it.
 *
 * It is safe by construction and never ships a real code to a real user:
 *   - returns null unless NODE_ENV !== 'production' AND no RESEND_API_KEY
 *     (the exact condition under which sendCodeEmail also falls back to the
 *     console instead of actually mailing);
 *   - only ever reveals the *caller's own* code, keyed on their session `sub`
 *     (the SQL function brute-forces only that one row's hash);
 *   - goes through a security-definer function, never a raw table select
 *     (login_codes grants SELECT to no one).
 */
export async function devPeekCode(purpose: CodePurpose): Promise<string | null> {
  if (process.env.NODE_ENV === 'production' || process.env.RESEND_API_KEY) return null

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase.rpc('dev_peek_code', { p_purpose: purpose })
  if (error) return null
  return (data as string | null) || null
}
