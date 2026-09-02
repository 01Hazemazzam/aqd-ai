// tests/intelligence/format-derivation.test.ts
//
// The derivation is what the product offers instead of a confidence score, so
// it is the sentence a user actually reads to decide whether to trust a date.
// It has to say the same thing in both languages -- an English-only
// explanation in an Arabic-first product is the defect this module exists to
// fix.
import { describe, it, expect } from 'vitest'
import { formatDerivation, type DerivationStrings } from '@/app/(app)/intelligence/format-derivation'
import type { Derivation } from '@/lib/intelligence/due-spec'

const EN: DerivationStrings = {
  derivedFrom: 'From',
  separator: ',',
  anchor: { absolute_date: 'stated date', effective_date: 'effective date', term_end: 'initial term end' },
  direction: { before: 'minus', after: 'plus' },
  unit: { day: 'days', week: 'weeks', month: 'months', year: 'years' },
}

const AR: DerivationStrings = {
  derivedFrom: 'مستمدّ من',
  separator: '،',
  anchor: { absolute_date: 'التاريخ المنصوص عليه', effective_date: 'تاريخ النفاذ', term_end: 'نهاية المدة الأولية' },
  direction: { before: 'ناقص', after: 'زائد' },
  unit: { day: 'يوماً', week: 'أسبوعاً', month: 'شهراً', year: 'سنة' },
}

const iso = (d: string) => d

const RENEWAL: Derivation = {
  anchor: 'term_end',
  anchorDate: '2028-05-31',
  direction: 'before',
  offset: 60,
  unit: 'day',
  verbatim: null,
}

describe('formatDerivation', () => {
  it('writes the renewal window as a sentence in English', () => {
    expect(formatDerivation(RENEWAL, EN, iso)).toBe('initial term end 2028-05-31, minus 60 days')
  })

  // Arabic punctuates with U+060C, not the Latin comma. Hardcoding one gets
  // the other subtly wrong, which is the kind of detail that makes a
  // bilingual product read as translated rather than written.
  it('writes the same derivation in Arabic, with Arabic punctuation', () => {
    expect(formatDerivation(RENEWAL, AR, iso)).toBe('نهاية المدة الأولية 2028-05-31، ناقص 60 يوماً')
  })

  it('says nothing when there is nothing to explain', () => {
    expect(formatDerivation(null, EN, iso)).toBeNull()
  })

  it('gives the anchor alone when no interval was applied', () => {
    const onDate: Derivation = { anchor: 'effective_date', anchorDate: '2026-09-01', direction: null, offset: null, unit: null, verbatim: null }
    expect(formatDerivation(onDate, EN, iso)).toBe('effective date 2026-09-01')
  })

  it('states a term end as the effective date plus the document’s own wording', () => {
    // "plus twenty-one (21) months" is what the contract says; restating it
    // as "plus 21 months" would put words in the document's mouth.
    const termEnd: Derivation = { anchor: 'effective_date', anchorDate: '2026-09-01', direction: 'after', offset: null, unit: null, verbatim: null }
    expect(formatDerivation(termEnd, EN, iso, 'twenty-one (21) months')).toBe('effective date 2026-09-01 plus twenty-one (21) months')
  })

  it('falls back to the document’s phrase for an interval the calendar cannot show', () => {
    const hours: Derivation = {
      anchor: 'effective_date',
      anchorDate: '2026-09-01',
      direction: null,
      offset: null,
      unit: null,
      verbatim: 'within seventy-two (72) hours',
    }
    expect(formatDerivation(hours, EN, iso)).toBe('effective date 2026-09-01 (within seventy-two (72) hours)')
  })

  it('formats the anchor date through the caller’s formatter, so it is localised too', () => {
    const fmt = (d: string) => `[${d}]`
    expect(formatDerivation(RENEWAL, EN, fmt)).toContain('[2028-05-31]')
  })

  it('counts a month offset in months rather than converting it to days', () => {
    const months: Derivation = { anchor: 'term_end', anchorDate: '2028-05-31', direction: 'after', offset: 3, unit: 'month', verbatim: null }
    expect(formatDerivation(months, EN, iso)).toBe('initial term end 2028-05-31, plus 3 months')
  })
})
