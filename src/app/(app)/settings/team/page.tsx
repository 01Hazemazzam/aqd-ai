import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { InviteForm } from './invite-form'
import { MemberRow } from './member-row'
import { cancelInvite } from './actions'

const ROLE_TONE = { owner: 'brass', admin: 'accent', member: 'neutral' } as const

type Member = { user_id: string; email: string; role: 'owner' | 'admin' | 'member'; created_at: string }

export default async function TeamPage() {
  const t = await getTranslations('team')
  const supabase = await createServerSupabase()
  const orgId = await getCurrentOrgId()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: membersData }, { data: invites }] = await Promise.all([
    supabase.rpc('list_org_members'),
    supabase.from('invites').select('id, email, role, expires_at').eq('org_id', orgId).is('accepted_at', null).order('created_at', { ascending: false }),
  ])
  const members = membersData as Member[] | null

  const myRole = members?.find((m) => m.user_id === user?.id)?.role
  const canManage = myRole === 'owner' || myRole === 'admin'
  const isLastOwner = myRole === 'owner' && (members?.filter((m) => m.role === 'owner').length ?? 0) <= 1

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
      <h1 className="mb-8 font-serif text-3xl font-medium tracking-tight text-ink text-balance">{t('title')}</h1>

      {canManage && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('inviteTitle')}</h2>
          <Card>
            <InviteForm canInviteOwner={myRole === 'owner'} />
          </Card>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('membersTitle')}</h2>
        <ul className="flex flex-col gap-3">
          {(members ?? []).map((member) => (
            <li key={member.user_id}>
              <Card className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{member.email}</p>
                  {member.user_id === user?.id && <p className="text-xs text-ink-faint">{t('you')}</p>}
                </div>
                {canManage ? (
                  <MemberRow
                    userId={member.user_id}
                    role={member.role}
                    isSelf={member.user_id === user?.id}
                    isLastOwner={member.role === 'owner' && isLastOwner}
                    canGrantOwner={myRole === 'owner'}
                  />
                ) : (
                  <Badge tone={ROLE_TONE[member.role as keyof typeof ROLE_TONE]}>{t(`roles.${member.role}`)}</Badge>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {canManage && !!invites?.length && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('pendingTitle')}</h2>
          <ul className="flex flex-col gap-3">
            {invites.map((invite) => (
              <li key={invite.id}>
                <Card className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{invite.email}</p>
                    <p className="text-xs text-ink-faint">{t(`roles.${invite.role}`)}</p>
                  </div>
                  <form action={cancelInvite.bind(null, invite.id)}>
                    <button type="submit" className="text-sm font-medium text-risk-high hover:underline">{t('cancelInvite')}</button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
