import { requireSession } from '@/lib/auth/guards'

// requireSession rather than requireVerified: create_organization only ever
// acts on the caller's own `sub`, and requireVerified would add a redirect to
// /verify that this flow cannot satisfy -- verify_code consumes the login
// code, it does not set auth.users.email_confirmed_at.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  return children
}
