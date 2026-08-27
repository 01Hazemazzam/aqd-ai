import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createServerSupabase } from '@/lib/supabase/server'
import { getDeviceSecret } from './device'

export const requireSession = cache(async () => {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return user
})

/**
 * A fully verified session: the email is confirmed AND this device is trusted.
 * Both checks are server-side reads. There is no client-side flag that grants entry.
 */
export const requireVerified = cache(async () => {
  const user = await requireSession()
  if (!user.email_confirmed_at) redirect('/verify')

  const supabase = await createServerSupabase()
  const secret = await getDeviceSecret()
  const { data: trusted } = await supabase.rpc('is_device_trusted', { p_secret: secret ?? '' })
  if (!trusted) redirect('/challenge')

  return user
})
