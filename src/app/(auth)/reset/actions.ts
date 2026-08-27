'use server'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

export async function requestReset(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const supabase = await createServerSupabase()

  // The result is deliberately ignored. A reset form that behaved differently
  // for a known and an unknown address would be an account-enumeration oracle.
  await supabase.auth.resetPasswordForEmail(email)

  redirect(`/reset?step=confirm&email=${encodeURIComponent(email)}`)
}

export async function confirmReset(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const code = String(formData.get('code') ?? '')
  const password = String(formData.get('password') ?? '')

  if (password.length < 10) return { error: 'weakPassword' as const }

  const supabase = await createServerSupabase()

  const { error: otpError } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' })
  if (otpError) return { error: 'code_incorrect' as const }

  const { error: updateError } = await supabase.auth.updateUser({ password })
  if (updateError) return { error: 'unknown' as const }

  // A stolen password already used from a trusted device would otherwise keep
  // working after the reset. Revoking here is what closes that hole.
  await supabase.rpc('revoke_all_devices')

  redirect('/login?reset=done')
}
