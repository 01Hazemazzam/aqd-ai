// tests/auth/errors.test.ts
import { describe, it, expect } from 'vitest'
import { toAuthErrorCode } from '@/lib/auth/errors'

describe('toAuthErrorCode', () => {
  it.each([
    ['code_incorrect', 'code_incorrect'],
    ['code_expired', 'code_expired'],
    ['code_burned', 'code_burned'],
    ['rate_limited', 'rate_limited'],
  ])('maps the SQL exception %s', (raised, expected) => {
    expect(toAuthErrorCode({ message: `${raised}` })).toBe(expected)
  })

  it('maps anything unrecognised to unknown', () => {
    expect(toAuthErrorCode({ message: 'connection reset by peer' })).toBe('unknown')
  })

  it('collapses every credential failure to one indistinguishable code', () => {
    expect(toAuthErrorCode({ message: 'Invalid login credentials' })).toBe('invalid_credentials')
    expect(toAuthErrorCode({ message: 'Email not confirmed' })).toBe('invalid_credentials')
  })
})
