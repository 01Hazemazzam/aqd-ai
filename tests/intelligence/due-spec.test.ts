// tests/intelligence/due-spec.test.ts
//
// resolveDue is the line between "the contract states a deadline" and "we
// worked one out". Every spec below is the structure of a `due` phrase that
// actually appears in the analysed corpus, so the pass/refuse split here is
// the real portfolio's split. See ADR-0003.
import { describe, it, expect } from 'vitest'
import { resolveDue, type DueSpec, type ContractFacts } from '@/lib/intelligence/due-spec'

// The hard QA fixture: effective 1 September 2026, initial term 21 months,
// which the document itself says ends 31 May 2028.
const FACTS: ContractFacts = { effectiveDate: '1 September 2026', termLength: 'twenty-one (21) months' }
const NO_FACTS: ContractFacts = { effectiveDate: null, termLength: null }

function spec(over: Partial<DueSpec> = {}): DueSpec {
  return {
    verbatim: 'at least sixty (60) days before the end of the then-current term',
    offset: 60,
    unit: 'day',
    direction: 'before',
    anchor: 'term_end',
    anchorDate: null,
    ...over,
  }
}

describe('resolveDue :: the renewal window, which is the case worth building for', () => {
  it('resolves a notice period counted back from the initial term end', () => {
    const r = resolveDue(spec(), FACTS)
    expect(r.status).toBe('resolved')
    expect(r.date).toBe('2028-04-01') // 2028-05-31 minus 60 days
  })

  it('shows its arithmetic instead of a confidence score', () => {
    // The user should be able to see WHY a date exists. A number could not
    // have told them.
    expect(resolveDue(spec(), FACTS).derivation).toBe('initial term end 2028-05-31, minus 60 days')
  })

  it('resolves the ninety-day variant the corpus also contains', () => {
    const r = resolveDue(spec({ offset: 90, verbatim: 'at least ninety (90) days before the end of the then-current term' }), FACTS)
    expect(r.date).toBe('2028-03-02')
  })

  it('refuses when the contract does not state both the effective date and the term', () => {
    const r = resolveDue(spec(), NO_FACTS)
    expect(r.status).toBe('unresolved')
    expect(r.reason).toBe('term_not_stated')
    expect(r.date).toBeNull()
  })

  it('refuses when the term is stated but never ends', () => {
    expect(resolveDue(spec(), { effectiveDate: '1 September 2026', termLength: 'evergreen' }).reason).toBe('term_not_stated')
  })
})

describe('resolveDue :: anchors that can never become a date', () => {
  // 38 of 147 real obligations are of this kind. The contract gives the
  // interval but never dates the event, so no date exists to compute --
  // assuming one is exactly the fabrication ADR-0002 exists to prevent.
  it('never resolves an interval from an undated contract event', () => {
    for (const verbatim of [
      'within thirty (30) days after receipt',
      'Within thirty (30) days after termination',
      'without undue delay and in any event within seventy-two (72) hours after confirmation',
      'within five (5) Business Days after receiving the request',
    ]) {
      const r = resolveDue(spec({ verbatim, anchor: 'contract_event', direction: 'after' }), FACTS)
      expect(r.status).toBe('unresolved')
      expect(r.reason).toBe('anchor_not_dated')
      expect(r.date).toBeNull()
    }
  })

  it('does not resolve a business-day interval, since the holiday calendar is not in the contract', () => {
    // The documents define "Business Day" as excluding Friday, Saturday and
    // Kuwaiti public holidays -- and never enumerate the holidays.
    const r = resolveDue(
      spec({ verbatim: 'within ten (10) Business Days after the Effective Date', offset: 10, unit: 'business_day', direction: 'after', anchor: 'effective_date' }),
      FACTS,
    )
    expect(r.status).toBe('unresolved')
    expect(r.reason).toBe('unit_not_computable')
  })

  it('reports an obligation the document sets no time for as exactly that', () => {
    const r = resolveDue(spec({ verbatim: '', offset: null, unit: null, direction: null, anchor: 'none' }), FACTS)
    expect(r.status).toBe('no_deadline_stated')
    expect(r.reason).toBeNull()
  })

  it('treats a missing specification as no deadline stated, not as a failure', () => {
    expect(resolveDue(null, FACTS).status).toBe('no_deadline_stated')
    expect(resolveDue(undefined, FACTS).status).toBe('no_deadline_stated')
  })
})

describe('resolveDue :: the effective date and absolute anchors', () => {
  it('counts forward from the effective date', () => {
    const r = resolveDue(
      spec({ verbatim: 'within thirty (30) days after the Effective Date', offset: 30, unit: 'day', direction: 'after', anchor: 'effective_date' }),
      FACTS,
    )
    expect(r.date).toBe('2026-10-01')
    expect(r.derivation).toBe('effective date 2026-09-01, plus 30 days')
  })

  it('refuses an effective-date anchor when no effective date was extracted', () => {
    const r = resolveDue(spec({ anchor: 'effective_date', direction: 'after' }), { effectiveDate: null, termLength: '24 months' })
    expect(r.reason).toBe('effective_date_not_stated')
  })

  it('uses a date the document names outright', () => {
    const r = resolveDue(
      spec({ verbatim: 'by 30 June 2027', offset: null, unit: null, direction: 'on', anchor: 'absolute_date', anchorDate: '30 June 2027' }),
      NO_FACTS,
    )
    expect(r.status).toBe('resolved')
    expect(r.date).toBe('2027-06-30')
  })

  it('refuses an absolute anchor whose date it cannot read unambiguously', () => {
    const r = resolveDue(spec({ anchor: 'absolute_date', anchorDate: '03/04/2027', direction: 'on', offset: null, unit: null }), NO_FACTS)
    expect(r.status).toBe('unresolved')
    expect(r.reason).toBe('incomplete_spec')
  })
})

describe('resolveDue :: units and directions', () => {
  it('handles months and years as calendar arithmetic, not 30-day blocks', () => {
    expect(resolveDue(spec({ offset: 1, unit: 'month', direction: 'after', anchor: 'effective_date' }), FACTS).date).toBe('2026-10-01')
    expect(resolveDue(spec({ offset: 4, unit: 'year', direction: 'after', anchor: 'term_end', verbatim: 'four (4) years after termination' }), FACTS).date).toBe('2032-05-31')
  })

  it('handles weeks', () => {
    expect(resolveDue(spec({ offset: 2, unit: 'week', direction: 'after', anchor: 'effective_date' }), FACTS).date).toBe('2026-09-15')
  })

  it('lands an hours-level interval on the day it counts from, without implying a time', () => {
    // The timeline's unit is the day; carrying hours would show a precision
    // it cannot represent.
    const r = resolveDue(
      spec({ verbatim: 'within seventy-two (72) hours', offset: 72, unit: 'hour', direction: 'after', anchor: 'effective_date' }),
      FACTS,
    )
    expect(r.status).toBe('resolved')
    expect(r.date).toBe('2026-09-01')
    expect(r.derivation).toContain('seventy-two (72) hours')
  })

  it('resolves an anchor with no interval to the anchor itself', () => {
    const r = resolveDue(spec({ verbatim: 'on the Effective Date', offset: null, unit: null, direction: 'on', anchor: 'effective_date' }), FACTS)
    expect(r.date).toBe('2026-09-01')
  })

  it('refuses a spec with an offset but no direction, which could go either way', () => {
    expect(resolveDue(spec({ direction: null }), FACTS).reason).toBe('incomplete_spec')
  })

  it('writes a singular unit in the derivation for an offset of one', () => {
    expect(resolveDue(spec({ offset: 1, unit: 'day' }), FACTS).derivation).toBe('initial term end 2028-05-31, minus 1 day')
  })
})
