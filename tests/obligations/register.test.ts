// tests/obligations/register.test.ts
//
// buildObligationRegister turns the analysis extractor's free-text `due`
// strings into a dated timeline + a conditional list. The extractor never
// computes dates, so the risk here is the OPPOSITE of missing a date: wrongly
// promoting a trigger phrase ("within 30 days...") to a concrete calendar date.
// These lock the parser to concrete dates only and pin the urgency buckets.
import { describe, it, expect } from 'vitest'
import { buildObligationRegister, type RawObligation } from '@/lib/obligations/register'

const TODAY = new Date('2026-09-02T12:00:00Z')

function ob(due: string | null, extra: Partial<RawObligation> = {}): RawObligation {
  return { contractId: 'c1', contractTitle: 'Contract One', obligor: 'Licensee', action: 'Pay the fee', due, ...extra }
}

describe('buildObligationRegister', () => {
  it('places an ISO date on the timeline with a computed urgency', () => {
    const { dated, conditional } = buildObligationRegister([ob('2026-09-20')], TODAY)
    expect(conditional).toHaveLength(0)
    expect(dated).toHaveLength(1)
    expect(dated[0].dueDate).toBe('2026-09-20')
    expect(dated[0].urgency).toBe('soon') // 18 days out, <= 30
  })

  it('parses "Month D, YYYY" and "D Month YYYY" and an ordinal suffix', () => {
    const { dated } = buildObligationRegister(
      [ob('June 30, 2027'), ob('15 March 2027'), ob('Dec 1, 2026'), ob('3rd April 2027')],
      TODAY,
    )
    expect(dated.map((d) => d.dueDate)).toEqual(['2026-12-01', '2027-03-15', '2027-04-03', '2027-06-30'])
  })

  it('classifies overdue / soon / upcoming relative to today', () => {
    const { dated } = buildObligationRegister(
      [ob('2026-08-01'), ob('2026-09-10'), ob('2027-01-01')],
      TODAY,
    )
    const byDate = Object.fromEntries(dated.map((d) => [d.dueDate, d.urgency]))
    expect(byDate['2026-08-01']).toBe('overdue')
    expect(byDate['2026-09-10']).toBe('soon')
    expect(byDate['2027-01-01']).toBe('upcoming')
  })

  it('treats today itself as soon, not overdue', () => {
    const { dated } = buildObligationRegister([ob('2026-09-02')], TODAY)
    expect(dated[0].urgency).toBe('soon')
  })

  it('keeps trigger-based and recurring dues as conditional, never inventing a date', () => {
    const rows = [
      ob('within 30 days of termination'),
      ob('annually on the anniversary'),
      ob('upon receipt of invoice'),
      ob('30 days after delivery'),
      ob(null),
    ]
    const { dated, conditional } = buildObligationRegister(rows, TODAY)
    expect(dated).toHaveLength(0)
    expect(conditional).toHaveLength(5)
  })

  it('does NOT parse ambiguous numeric slash dates -- leaves them conditional', () => {
    // 03/04/2027 could be 3 April or 4 March; guessing risks a wrong deadline.
    const { dated, conditional } = buildObligationRegister([ob('03/04/2027')], TODAY)
    expect(dated).toHaveLength(0)
    expect(conditional).toHaveLength(1)
  })

  it('does not mistake a bare year or number for a date', () => {
    const { dated, conditional } = buildObligationRegister([ob('2027'), ob('within 90 days')], TODAY)
    expect(dated).toHaveLength(0)
    expect(conditional).toHaveLength(2)
  })

  it('sorts the timeline ascending across contracts', () => {
    const rows = [
      ob('2027-05-01', { contractId: 'c2', contractTitle: 'Two' }),
      ob('2026-10-01', { contractId: 'c1', contractTitle: 'One' }),
      ob('2026-12-15', { contractId: 'c3', contractTitle: 'Three' }),
    ]
    const { dated } = buildObligationRegister(rows, TODAY)
    expect(dated.map((d) => d.dueDate)).toEqual(['2026-10-01', '2026-12-15', '2027-05-01'])
    expect(dated.map((d) => d.contractTitle)).toEqual(['One', 'Three', 'Two'])
  })
})
