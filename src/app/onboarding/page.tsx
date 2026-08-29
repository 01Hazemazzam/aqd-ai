import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { AuthShell } from '@/components/auth/auth-shell'
import { CreateOrgForm } from './create-org-form'
import { AcceptInviteForm } from './accept-invite-form'

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  const t = await getTranslations('onboarding')
  const { invite } = await searchParams

  if (invite) {
    const supabase = await createServerSupabase()
    const { data } = await supabase.rpc('preview_invite', { p_token: invite }).maybeSingle()
    const preview = data as { org_name: string; role: 'owner' | 'admin' | 'member' } | null
    if (preview) {
      return (
        <AuthShell title={t('inviteTitle')} subtitle="">
          <AcceptInviteForm token={invite} orgName={preview.org_name} role={preview.role} />
        </AuthShell>
      )
    }
    // Falls through to the create-organization form below: an invalid or
    // expired invite link shouldn't strand the user with no way forward.
  }

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <CreateOrgForm />
    </AuthShell>
  )
}
