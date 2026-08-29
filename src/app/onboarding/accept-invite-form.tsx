'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { acceptInvite } from './actions'

export function AcceptInviteForm({ token, orgName, role }: { token: string; orgName: string; role: 'owner' | 'admin' | 'member' }) {
  const t = useTranslations('onboarding')
  const teamT = useTranslations('team')
  const [state, action, pending] = useActionState(acceptInvite, null)

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-ink-dim">{t('inviteBody', { org: orgName, role: teamT(`roles.${role}`) })}</p>
      <input type="hidden" name="token" value={token} />
      {state?.error && <p role="alert" className="text-sm text-risk-high">{t('inviteInvalid')}</p>}
      <Button type="submit" loading={pending}>{t('acceptInvite')}</Button>
    </form>
  )
}
