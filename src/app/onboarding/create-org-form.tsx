'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createOrganization } from './actions'

export function CreateOrgForm() {
  const t = useTranslations('onboarding')
  const [state, action, pending] = useActionState(createOrganization, null)

  return (
    <form action={action} className="flex flex-col gap-4">
      <Input
        label={t('name')} name="name" required
        error={state?.error === 'invalid_name' ? t('name') : undefined}
      />
      <Button type="submit" loading={pending}>{t('submit')}</Button>
    </form>
  )
}
