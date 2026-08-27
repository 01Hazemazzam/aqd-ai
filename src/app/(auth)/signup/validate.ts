export type SignupIssue = 'invalidEmail' | 'weakPassword'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateSignup(email: string, password: string): SignupIssue | null {
  if (!EMAIL.test(email)) return 'invalidEmail'
  if (password.length < 10) return 'weakPassword'
  return null
}
