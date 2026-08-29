'use server'
import { revalidatePath } from 'next/cache'
import { getLocale } from 'next-intl/server'
import { headers } from 'next/headers'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { sendInviteEmail } from '@/lib/auth/email'
import type { Locale } from '@/lib/i18n/config'

type OrgRole = 'owner' | 'admin' | 'member'

export async function inviteMember(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const role = String(formData.get('role') ?? 'member') as OrgRole
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'invalid_email' as const }

  const supabase = await createServerSupabase()
  const orgId = await getCurrentOrgId()
  const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()

  const { data: token, error } = await supabase.rpc('create_invite', { p_email: email, p_role: role })
  if (error) {
    const code = error.message.includes('not_authorized') ? 'not_authorized' as const : 'unknown' as const
    return { error: code }
  }

  const h = await headers()
  const origin = h.get('origin') ?? `https://${h.get('host')}`
  const locale = (await getLocale()) as Locale
  await sendInviteEmail(email, org?.name ?? 'Aqd', `${origin}/onboarding?invite=${token}`, locale)

  revalidatePath('/settings/team')
  return { error: null, success: true as const }
}

export async function cancelInvite(inviteId: string) {
  const supabase = await createServerSupabase()
  await supabase.from('invites').delete().eq('id', inviteId)
  revalidatePath('/settings/team')
}

// "An org must always keep at least one owner" is enforced here, not as a DB
// trigger -- a trigger on org_members also fires for a cascaded delete (e.g.
// a whole account being deleted), which is a different situation than this
// UI deliberately demoting or removing one member. This check only guards
// the deliberate action this page can actually take.
async function wouldRemoveLastOwner(orgId: string, userId: string): Promise<boolean> {
  const admin = await createServerSupabase()
  const { data } = await admin.from('org_members').select('user_id').eq('org_id', orgId).eq('role', 'owner')
  const owners = data ?? []
  return owners.length === 1 && owners[0].user_id === userId
}

export async function changeMemberRole(userId: string, role: OrgRole) {
  const orgId = await getCurrentOrgId()
  if (role !== 'owner' && (await wouldRemoveLastOwner(orgId, userId))) {
    return { error: 'last_owner' as const }
  }

  const supabase = await createServerSupabase()
  const { error } = await supabase.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId)
  revalidatePath('/settings/team')
  return { error: error ? 'unknown' as const : null }
}

export async function removeMember(userId: string) {
  const orgId = await getCurrentOrgId()
  if (await wouldRemoveLastOwner(orgId, userId)) {
    return { error: 'last_owner' as const }
  }

  const supabase = await createServerSupabase()
  const { error } = await supabase.from('org_members').delete().eq('org_id', orgId).eq('user_id', userId)
  revalidatePath('/settings/team')
  return { error: error ? 'unknown' as const : null }
}
