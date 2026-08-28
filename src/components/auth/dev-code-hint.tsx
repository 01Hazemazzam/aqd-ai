import { devPeekCode } from '@/lib/auth/dev-code'
import type { CodePurpose } from '@/lib/auth/codes'

/**
 * DEV ONLY. Renders the caller's current code inline so the verify/challenge
 * screens are usable locally without an email transport. `devPeekCode` returns
 * null in production (and whenever a real RESEND_API_KEY is set), so this
 * component renders nothing there -- it never leaks a code to a real user.
 */
export async function DevCodeHint({ purpose }: { purpose: CodePurpose }) {
  const code = await devPeekCode(purpose)
  if (!code) return null

  return (
    <div className="mb-6 rounded-lg border border-dashed border-brass/50 bg-surface-3 px-3 py-2 text-sm text-ink-dim">
      <span className="font-semibold text-brass">Dev</span> — no email is sent locally. Your code is{' '}
      <code className="font-mono font-bold tracking-widest text-ink">{code}</code>
    </div>
  )
}
