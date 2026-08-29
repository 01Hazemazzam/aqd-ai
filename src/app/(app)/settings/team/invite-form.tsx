'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { inviteMember } from './actions'

export function InviteForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const t = useTranslations('team')
  const [state, action, pending] = useActionState(inviteMember, null)

  const errorText =
    state?.error === 'invalid_email' ? t('errors.invalid_email')
    : state?.error === 'not_authorized' ? t('errors.not_authorized')
    : state?.error ? t('errors.unknown')
    : undefined

  return (
    <form action={action} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Input label={t('emailLabel')} name="email" type="email" required error={errorText} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-role" className="text-sm font-medium text-ink">{t('roleLabel')}</label>
        <select
          id="invite-role"
          name="role"
          defaultValue="member"
          className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink"
        >
          <option value="member">{t('roles.member')}</option>
          <option value="admin">{t('roles.admin')}</option>
          {canInviteOwner && <option value="owner">{t('roles.owner')}</option>}
        </select>
      </div>
      <Button type="submit" loading={pending}>{t('inviteCta')}</Button>
      {state?.success && <p className="text-sm text-accent sm:self-center">{t('inviteSent')}</p>}
    </form>
  )
}
