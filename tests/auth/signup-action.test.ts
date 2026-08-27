import { describe, it, expect } from 'vitest'
import { validateSignup } from '@/app/(auth)/signup/validate'

describe('validateSignup', () => {
  it('accepts a well-formed email and a long password', () => {
    expect(validateSignup('hazem@example.com', 'a-long-enough-password')).toBeNull()
  })

  it('rejects a malformed email', () => {
    expect(validateSignup('hazem@', 'a-long-enough-password')).toBe('invalidEmail')
  })

  it('rejects a password under ten characters', () => {
    expect(validateSignup('hazem@example.com', 'short')).toBe('weakPassword')
  })
})
