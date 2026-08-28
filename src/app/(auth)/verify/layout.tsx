import { requireSession } from '@/lib/auth/guards'

// requireSession, never requireVerified: requireVerified redirects an
// unconfirmed user *to this very page*, so guarding it with that would loop
// forever. A session is the correct bar here -- you reach /verify only after
// signing up, and verify_code acts on your own `sub` claim regardless.
export default async function VerifyLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  return children
}
