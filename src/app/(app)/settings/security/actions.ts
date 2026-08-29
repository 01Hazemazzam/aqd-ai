'use server'
import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'

// Relies on the devices_own_revoke RLS policy (migration 0003): a plain
// update through the caller's session client, no security-definer function
// needed -- a user can only ever match rows where user_id = auth.uid().
// Return type is void, not a result object: this is bound directly as a
// plain <form action> in a Server Component (no useActionState consuming a
// result), same shape as cancelInvite in the team actions.
export async function revokeDevice(deviceId: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { error } = await supabase
    .from('trusted_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', deviceId)
    .eq('user_id', user.id)

  if (error) return

  await supabase.from('auth_events').insert({ kind: 'device_revoked' })
  revalidatePath('/settings/security')
}
