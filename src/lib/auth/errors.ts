export type AuthErrorCode =
  | 'code_incorrect' | 'code_expired' | 'code_burned'
  | 'rate_limited' | 'invalid_credentials' | 'signups_closed' | 'unknown'

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode }

const SQL_CODES: AuthErrorCode[] = ['code_incorrect', 'code_expired', 'code_burned', 'rate_limited']

// Every credential failure collapses to one code so the login form cannot be
// used to discover which emails have accounts.
const CREDENTIAL_PATTERNS = [/invalid login credentials/i, /email not confirmed/i, /user not found/i]

// A closed deployment refuses at the Supabase level, and GoTrue says so in
// words. Without this the refusal collapsed into `unknown` -- "Something went
// wrong. Please try again." -- which reads as a fault in the product and
// invites the retry that cannot succeed.
const SIGNUPS_CLOSED_PATTERN = /signups? not allowed|signup is disabled/i

export function toAuthErrorCode(error: { message?: string } | null | undefined): AuthErrorCode {
  const message = error?.message ?? ''
  for (const c of SQL_CODES) if (message.includes(c)) return c
  if (SIGNUPS_CLOSED_PATTERN.test(message)) return 'signups_closed'
  for (const p of CREDENTIAL_PATTERNS) if (p.test(message)) return 'invalid_credentials'
  return 'unknown'
}
