import { describe, it, expect } from 'vitest'
import { dirFor, LOCALES } from '@/lib/i18n/config'
import en from '../messages/en.json'
import ar from '../messages/ar.json'

const keys = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  )

describe('i18n', () => {
  it('resolves direction per locale', () => {
    expect(dirFor('en')).toBe('ltr')
    expect(dirFor('ar')).toBe('rtl')
  })

  it('supports exactly English and Arabic', () => {
    expect(LOCALES).toEqual(['en', 'ar'])
  })

  it('has identical key sets in both message files', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort())
  })
})
