import { requireVerified } from '@/lib/auth/guards'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireVerified()
  return <div className="min-h-dvh bg-surface">{children}</div>
}
