// tests/auth/device.test.ts
import { describe, it, expect } from 'vitest'
import { newDeviceSecret, DEVICE_COOKIE_OPTIONS } from '@/lib/auth/device'

describe('device secret', () => {
  it('generates a long, url-safe, unguessable secret', () => {
    const s = newDeviceSecret()
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newDeviceSecret()).not.toBe(s)
  })

  it('is stored in an httpOnly, sameSite cookie', () => {
    expect(DEVICE_COOKIE_OPTIONS.httpOnly).toBe(true)
    expect(DEVICE_COOKIE_OPTIONS.sameSite).toBe('lax')
    expect(DEVICE_COOKIE_OPTIONS.path).toBe('/')
  })
})
