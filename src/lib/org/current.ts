import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

export async function getCurrentOrgId(): Promise<string> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase.from('org_members').select('org_id').eq('user_id', user.id).limit(1).single()
  if (!data) redirect('/onboarding')

  return data.org_id
}
