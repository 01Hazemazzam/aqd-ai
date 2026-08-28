import { requireSession } from '@/lib/auth/guards'

// requireSession, never requireVerified: requireVerified redirects an
// untrusted device *to this very page*, so guarding it with that would loop
// forever. Reaching /challenge already means a password was accepted -- the
// device check is what this screen exists to complete.
export default async function ChallengeLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  return children
}
