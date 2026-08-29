import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { revokeDevice } from './actions'

const EVENT_TONE: Record<string, 'neutral' | 'accent' | 'brass'> = {
  login_failed: 'brass',
  code_failed: 'brass',
  code_send_failed: 'brass',
  device_revoked: 'brass',
}

export default async function SecurityPage() {
  const t = await getTranslations('security')
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: devices } = await supabase
    .from('trusted_devices')
    .select('id, label, user_agent, last_seen_at, expires_at, revoked_at')
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('last_seen_at', { ascending: false })

  const { data: events } = await supabase
    .from('auth_events')
    .select('id, kind, created_at, user_agent')
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
      <h1 className="mb-8 font-serif text-3xl font-medium tracking-tight text-ink text-balance">{t('title')}</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('devicesTitle')}</h2>
        {!devices?.length && (
          <Card><p className="text-sm text-ink-dim">{t('devicesEmpty')}</p></Card>
        )}
        {!!devices?.length && (
          <ul className="flex flex-col gap-3">
            {devices.map((device) => (
              <li key={device.id}>
                <Card className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{device.label || device.user_agent || t('unknownDevice')}</p>
                    <p className="text-xs text-ink-faint">
                      {t('lastActive', { date: new Date(device.last_seen_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) })}
                    </p>
                  </div>
                  <form action={revokeDevice.bind(null, device.id)}>
                    <Button type="submit" variant="danger">{t('revoke')}</Button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('activityTitle')}</h2>
        {!events?.length && (
          <Card><p className="text-sm text-ink-dim">{t('activityEmpty')}</p></Card>
        )}
        {!!events?.length && (
          <ul className="flex flex-col gap-2">
            {events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-4 rounded-lg border border-edge bg-surface-2 px-4 py-2.5">
                <span className="text-sm text-ink-dim">{t.has(`events.${event.kind}`) ? t(`events.${event.kind}` as 'events.login') : event.kind}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-faint">
                    {new Date(event.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  <Badge tone={EVENT_TONE[event.kind] ?? 'neutral'}>{event.kind}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {user?.email && <p className="mt-10 text-xs text-ink-faint">{t('signedInAs', { email: user.email })}</p>}
    </main>
  )
}
