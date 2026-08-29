'use client'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { changeMemberRole, removeMember } from './actions'

type OrgRole = 'owner' | 'admin' | 'member'

export function MemberRow({
  userId,
  role,
  isSelf,
  isLastOwner,
  canGrantOwner,
}: {
  userId: string
  role: OrgRole
  isSelf: boolean
  isLastOwner: boolean
  canGrantOwner: boolean
}) {
  const t = useTranslations('team')
  const [pending, startTransition] = useTransition()

  // The last owner can be neither demoted nor removed here -- the DB trigger
  // (org_members_protect_last_owner) is the real guarantee; disabling the
  // control is just so the user gets an explained no-op instead of a raw
  // Postgres error string.
  if (isLastOwner) {
    return <span className="text-xs text-ink-faint">{t('lastOwnerNotice')}</span>
  }

  return (
    <div className="flex items-center gap-2">
      <select
        defaultValue={role}
        disabled={pending || isSelf}
        onChange={(e) => startTransition(() => { changeMemberRole(userId, e.target.value as OrgRole) })}
        className="rounded-lg border border-edge bg-surface-2 px-2 py-1 text-xs text-ink disabled:opacity-50"
      >
        <option value="member">{t('roles.member')}</option>
        <option value="admin">{t('roles.admin')}</option>
        {canGrantOwner && <option value="owner">{t('roles.owner')}</option>}
      </select>
      {!isSelf && (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => { removeMember(userId) })}
          className="text-xs font-medium text-risk-high hover:underline disabled:opacity-50"
        >
          {t('remove')}
        </button>
      )}
    </div>
  )
}
