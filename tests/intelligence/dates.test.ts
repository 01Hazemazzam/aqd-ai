// tests/intelligence/dates.test.ts
//
// Every value here is a real string from the analysed corpus. The parsers
// exist to refuse things, so most of these assert null -- see ADR-0003.
import { describe, it, expect } from 'vitest'
import { parseStatedDate, parseTermMonths, addMonths, addDays, initialTermEnd } from '@/lib/intelligence/dates'

describe('parseStatedDate', () => {
  it('reads the formats the extractor actually produces', () => {
    expect(parseStatedDate('15 April 2026')).toBe('2026-04-15')
    expect(parseStatedDate('1 September 2026')).toBe('2026-09-01')
    expect(parseStatedDate('12 September 2026')).toBe('2026-09-12')
    expect(parseStatedDate('June 30, 2027')).toBe('2027-06-30')
    expect(parseStatedDate('2027-06-30')).toBe('2027-06-30')
  })

  it('refuses a slash date, whose day/month order is genuinely ambiguous', () => {
    // ADR-0002's boundary: guessing here puts a wrong date on a legal
    // timeline, which is worse than leaving it unplaced.
    expect(parseStatedDate('03/04/2027')).toBeNull()
  })

  it('refuses a relative phrase, which is not a date at all', () => {
    expect(parseStatedDate('within thirty (30) days after receipt')).toBeNull()
    expect(parseStatedDate('at least sixty (60) days before the end of the then-current term')).toBeNull()
    expect(parseStatedDate('without undue delay')).toBeNull()
  })

  it('refuses a date embedded in a larger phrase rather than digging it out', () => {
    expect(parseStatedDate('no later than 30 June 2027 unless extended')).toBeNull()
  })

  it('refuses an impossible calendar date', () => {
    expect(parseStatedDate('2027-02-31')).toBeNull()
  })

  it('treats absent input as absent, not as an error', () => {
    expect(parseStatedDate(null)).toBeNull()
    expect(parseStatedDate('')).toBeNull()
  })
})

describe('parseTermMonths', () => {
  it('reads the term formats in the corpus', () => {
    expect(parseTermMonths('24 months')).toBe(24)
    expect(parseTermMonths('30 months')).toBe(30)
    expect(parseTermMonths('27 months')).toBe(27)
    // Words plus a parenthesised numeral -- the numeral is authoritative.
    expect(parseTermMonths('eighteen (18) months')).toBe(18)
    expect(parseTermMonths('twenty (20) months')).toBe(20)
    expect(parseTermMonths('twenty-one (21) months')).toBe(21)
  })

  it('reads a term stated in words alone', () => {
    expect(parseTermMonths('twelve months')).toBe(12)
    expect(parseTermMonths('three years')).toBe(36)
  })

  it('converts years to months', () => {
    expect(parseTermMonths('2 years')).toBe(24)
    expect(parseTermMonths('one (1) year')).toBe(12)
  })

  it('refuses a term the document never fixes an end for', () => {
    expect(parseTermMonths('evergreen')).toBeNull()
    expect(parseTermMonths('until terminated by either party')).toBeNull()
    expect(parseTermMonths(null)).toBeNull()
    expect(parseTermMonths('')).toBeNull()
  })

  it('refuses a range, which would mean picking one end', () => {
    expect(parseTermMonths('18 to 24 months')).toBeNull()
  })

  it('refuses a term stated only in days, which is not a month count', () => {
    expect(parseTermMonths('90 days')).toBeNull()
  })
})

describe('addMonths', () => {
  it('adds and subtracts whole months', () => {
    expect(addMonths('2026-09-01', 21)).toBe('2028-06-01')
    expect(addMonths('2028-06-01', -21)).toBe('2026-09-01')
  })

  it('clamps to the last valid day rather than rolling into the next month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2028-06-01', -1)).toBe('2028-05-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -60)).toBe('2028-01-01')
  })
})

describe('initialTermEnd', () => {
  // The fixture states its own answer: "effective on 1 September 2026 and
  // continues for an initial term of twenty-one (21) months, ending on 31 May
  // 2028". Computing 31 May 2028 from the other two facts is what validates
  // the minus-one-day rule -- a term that runs FOR 21 months ends the day
  // before the anniversary.
  it('agrees with the term end the hard QA fixture states in its own words', () => {
    expect(initialTermEnd('1 September 2026', 'twenty-one (21) months')).toBe('2028-05-31')
  })

  it('computes the end of a term stated in plain months', () => {
    expect(initialTermEnd('15 April 2026', '24 months')).toBe('2028-04-14')
  })

  it('yields nothing when either fact is missing', () => {
    expect(initialTermEnd(null, '24 months')).toBeNull()
    expect(initialTermEnd('15 April 2026', null)).toBeNull()
    expect(initialTermEnd('15 April 2026', 'evergreen')).toBeNull()
  })

  it('yields nothing when the effective date is unparseable rather than guessing', () => {
    expect(initialTermEnd('03/04/2026', '24 months')).toBeNull()
  })
})
