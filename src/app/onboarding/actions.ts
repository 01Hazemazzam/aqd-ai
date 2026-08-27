'use server'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

export async function createOrganization(_prev: unknown, formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  if (name.length < 2) return { error: 'invalid_name' as const }

  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('create_organization', { p_name: name })
  if (error) return { error: 'unknown' as const }

  // The org claim is stamped at token mint, so refresh before entering the app.
  await supabase.auth.refreshSession()
  redirect('/')
}

export async function acceptInvite(_prev: unknown, formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) return { error: 'invite_invalid' as const }

  await supabase.auth.refreshSession()
  redirect('/')
}
