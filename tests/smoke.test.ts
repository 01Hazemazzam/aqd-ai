import { describe, it, expect } from 'vitest'
import { appName } from '@/lib/constants'

describe('scaffold', () => {
  it('exposes the app name', () => {
    expect(appName).toBe('Aqd AI')
  })
})
