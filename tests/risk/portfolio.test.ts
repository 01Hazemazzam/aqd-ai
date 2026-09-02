// tests/risk/portfolio.test.ts
//
// buildRiskPortfolio consolidates every risk finding across a tenant's
// analyzed contracts into portfolio counts, a severity breakdown, and a
// worst-first per-contract grouping. These pin the counting, the ranking
// (which contract and which finding leads), and that a missing-clause finding
// (clauseId null) survives aggregation so its contract-level drill-down works.
import { describe, it, expect } from 'vitest'
import { buildRiskPortfolio, type RawFinding, type Severity } from '@/lib/risk/portfolio'

let seq = 0
function f(severity: Severity, extra: Partial<RawFinding> = {}): RawFinding {
  seq += 1
  return {
    id: `f${seq}`,
    contractId: 'c1',
    contractTitle: 'Contract One',
    clauseId: 'cl1',
    clauseNumber: '1',
    severity,
    title: `Finding ${seq}`,
    reason: 'Because.',
    ruleKey: 'some_rule',
    ...extra,
  }
}

describe('buildRiskPortfolio', () => {
  it('returns all-zero totals for no findings', () => {
    const p = buildRiskPortfolio([])
    expect(p.total).toBe(0)
    expect(p.counts).toEqual({ high: 0, medium: 0, low: 0 })
    expect(p.contractsAffected).toBe(0)
    expect(p.contracts).toEqual([])
    expect(p.findings).toEqual([])
  })

  it('counts findings per severity across the portfolio', () => {
    const p = buildRiskPortfolio([f('high'), f('high'), f('medium'), f('low')])
    expect(p.total).toBe(4)
    expect(p.counts).toEqual({ high: 2, medium: 1, low: 1 })
  })

  it('groups findings by contract and counts each contract', () => {
    const p = buildRiskPortfolio([
      f('high', { contractId: 'a', contractTitle: 'Alpha' }),
      f('low', { contractId: 'a', contractTitle: 'Alpha' }),
      f('medium', { contractId: 'b', contractTitle: 'Bravo' }),
    ])
    expect(p.contractsAffected).toBe(2)
    const alpha = p.contracts.find((c) => c.contractId === 'a')!
    expect(alpha.total).toBe(2)
    expect(alpha.counts).toEqual({ high: 1, medium: 0, low: 1 })
    expect(alpha.topSeverity).toBe('high')
  })

  it('ranks contracts worst-first by top severity, then high count, then total', () => {
    const p = buildRiskPortfolio([
      f('low', { contractId: 'lowOnly', contractTitle: 'Low Only' }),
      f('high', { contractId: 'oneHigh', contractTitle: 'One High' }),
      f('high', { contractId: 'twoHigh', contractTitle: 'Two High' }),
      f('high', { contractId: 'twoHigh', contractTitle: 'Two High' }),
      f('medium', { contractId: 'medOnly', contractTitle: 'Med Only' }),
    ])
    expect(p.contracts.map((c) => c.contractId)).toEqual(['twoHigh', 'oneHigh', 'medOnly', 'lowOnly'])
  })

  it('sorts findings worst-first within a contract', () => {
    const p = buildRiskPortfolio([
      f('low', { title: 'Zeta low' }),
      f('high', { title: 'Alpha high' }),
      f('medium', { title: 'Mid medium' }),
    ])
    expect(p.contracts[0].findings.map((x) => x.severity)).toEqual(['high', 'medium', 'low'])
  })

  it('keeps a missing-clause finding (clauseId null) so it can drill to the contract', () => {
    const p = buildRiskPortfolio([f('high', { clauseId: null, clauseNumber: null, title: 'No termination clause' })])
    expect(p.findings).toHaveLength(1)
    expect(p.findings[0].clauseId).toBeNull()
    expect(p.contracts[0].topSeverity).toBe('high')
  })

  it('orders the flat findings list worst-first across contracts', () => {
    const p = buildRiskPortfolio([
      f('medium', { contractId: 'b', contractTitle: 'Bravo', title: 'B med' }),
      f('high', { contractId: 'b', contractTitle: 'Bravo', title: 'B high' }),
      f('high', { contractId: 'a', contractTitle: 'Alpha', title: 'A high' }),
    ])
    // Both highs lead (Alpha before Bravo on title), then the medium.
    expect(p.findings.map((x) => x.title)).toEqual(['A high', 'B high', 'B med'])
  })
})
