import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'

export const DEVICE_COOKIE = process.env.DEVICE_COOKIE_NAME ?? 'aqd_device'

export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

export function newDeviceSecret(): string {
  return randomBytes(32).toString('base64url')
}

export async function getDeviceSecret(): Promise<string | null> {
  const store = await cookies()
  return store.get(DEVICE_COOKIE)?.value ?? null
}

/** Returns the existing secret, minting and setting one if absent. */
export async function ensureDeviceSecret(persistDays?: number): Promise<string> {
  const store = await cookies()
  const existing = store.get(DEVICE_COOKIE)?.value
  if (existing) return existing

  const secret = newDeviceSecret()
  store.set(DEVICE_COOKIE, secret, {
    ...DEVICE_COOKIE_OPTIONS,
    ...(persistDays ? { maxAge: persistDays * 24 * 60 * 60 } : {}),
  })
  return secret
}
