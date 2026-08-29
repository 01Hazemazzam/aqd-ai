import { requireVerified } from '@/lib/auth/guards'
import { AppShell } from '@/components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireVerified()
  return <AppShell>{children}</AppShell>
}
