// tests/revision/risk-delta.test.ts
//
// This is the half of the comparison that makes a judgement, so it is the
// half that can mislead. The two things it must never do: claim a finding was
// fixed when all that is observed is that it stopped being reported, and
// merge two separate findings of the same rule into one.
import { describe, it, expect } from 'vitest'
import { compareRiskFindings, type DeltaFinding } from '@/lib/revision/risk-delta'

let seq = 0
const finding = (over: Partial<DeltaFinding> = {}): DeltaFinding => ({
  id: `f${++seq}`,
  ruleKey: 'liability_cap',
  kind: 'playbook',
  severity: 'high',
  title: 'Liability cap missing',
  ...over,
})

describe('compareRiskFindings :: what the revision changed', () => {
  it('reports a finding only the revision carries as introduced', () => {
    const base = [finding({ ruleKey: 'termination_notice', title: 'Short notice period', severity: 'medium' })]
    const revised = [
      finding({ ruleKey: 'termination_notice', title: 'Short notice period', severity: 'medium' }),
      finding({ ruleKey: 'indemnity_uncapped', title: 'Uncapped indemnity' }),
    ]

    const delta = compareRiskFindings(base, revised)

    expect(delta.introduced.map((f) => f.ruleKey)).toEqual(['indemnity_uncapped'])
    expect(delta.noLongerReported).toEqual([])
    expect(delta.carried).toHaveLength(1)
  })

  // The wording is the point. "Resolved" is a claim about the contract;
  // "no longer reported" is a claim about the analysis, and only the second
  // one is observed here.
  it('reports a finding the revision drops without claiming it was fixed', () => {
    const base = [finding()]
    const revised: DeltaFinding[] = []

    const delta = compareRiskFindings(base, revised)

    expect(delta.noLongerReported.map((f) => f.ruleKey)).toEqual(['liability_cap'])
    expect(delta.introduced).toEqual([])
  })

  it('reports the same finding graded harder as carried and worse', () => {
    const base = [finding({ severity: 'low' })]
    const revised = [finding({ severity: 'high' })]

    const [carried] = compareRiskFindings(base, revised).carried

    expect(carried.severityChange).toBe('worse')
    expect(carried.base.severity).toBe('low')
    expect(carried.revised.severity).toBe('high')
  })

  it('reports the same finding graded softer as carried and better', () => {
    const delta = compareRiskFindings([finding({ severity: 'high' })], [finding({ severity: 'medium' })])

    expect(delta.carried[0].severityChange).toBe('better')
    expect(delta.unchanged).toBe(false)
  })

  it('calls the risk profile unchanged only when nothing moved in either direction', () => {
    const delta = compareRiskFindings([finding()], [finding()])

    expect(delta.unchanged).toBe(true)
    expect(delta.carried[0].severityChange).toBe('same')
  })
})

describe('compareRiskFindings :: identity across two analyses', () => {
  // The rule key is the stable identity. The title is generated prose and
  // gets re-worded between runs over different text, so matching on it would
  // report the same finding as one departure and one arrival.
  it('follows a playbook finding through a re-worded title', () => {
    const base = [finding({ title: 'Liability cap missing' })]
    const revised = [finding({ title: 'No aggregate cap on liability' })]

    const delta = compareRiskFindings(base, revised)

    expect(delta.carried).toHaveLength(1)
    expect(delta.introduced).toEqual([])
    expect(delta.noLongerReported).toEqual([])
  })

  // A rule that fires against two different clauses is two findings. Pairing
  // them one-to-one is what keeps "one of the two was fixed" visible.
  it('pairs repeated findings of one rule one for one', () => {
    const base = [finding(), finding()]
    const revised = [finding()]

    const delta = compareRiskFindings(base, revised)

    expect(delta.carried).toHaveLength(1)
    expect(delta.noLongerReported).toHaveLength(1)
  })

  // Cross-clause findings have no rule key, so the title is all there is.
  // This is the weaker match, and it is weak in the safe direction: it
  // over-reports change rather than concealing it.
  it('falls back to the title for a finding with no rule', () => {
    const asymmetry = { ruleKey: null, kind: 'asymmetry', title: 'Termination rights are one-sided', severity: 'medium' as const }
    const delta = compareRiskFindings([finding(asymmetry)], [finding(asymmetry)])

    expect(delta.carried).toHaveLength(1)
    expect(delta.unchanged).toBe(true)
  })

  it('does not confuse a playbook finding with a cross-clause finding of the same wording', () => {
    const title = 'Termination rights are one-sided'
    const delta = compareRiskFindings(
      [finding({ ruleKey: null, kind: 'playbook', title })],
      [finding({ ruleKey: null, kind: 'asymmetry', title })],
    )

    expect(delta.carried).toEqual([])
    expect(delta.introduced).toHaveLength(1)
    expect(delta.noLongerReported).toHaveLength(1)
  })
})

describe('compareRiskFindings :: what the reader sees first', () => {
  it('counts both severity profiles so the shape of the change is one glance', () => {
    const base = [finding({ severity: 'high' }), finding({ ruleKey: 'a', severity: 'low' })]
    const revised = [finding({ ruleKey: 'b', severity: 'medium' })]

    const delta = compareRiskFindings(base, revised)

    expect(delta.counts.base).toEqual({ high: 1, medium: 0, low: 1 })
    expect(delta.counts.revised).toEqual({ high: 0, medium: 1, low: 0 })
  })

  it('orders introduced findings worst first', () => {
    const delta = compareRiskFindings(
      [],
      [
        finding({ ruleKey: 'a', severity: 'low', title: 'Low one' }),
        finding({ ruleKey: 'b', severity: 'high', title: 'High one' }),
        finding({ ruleKey: 'c', severity: 'medium', title: 'Medium one' }),
      ],
    )

    expect(delta.introduced.map((f) => f.severity)).toEqual(['high', 'medium', 'low'])
  })

  it('puts a carried finding whose grade moved above one that held still', () => {
    const delta = compareRiskFindings(
      [finding({ ruleKey: 'a', severity: 'high', title: 'A' }), finding({ ruleKey: 'b', severity: 'medium', title: 'B' })],
      [finding({ ruleKey: 'a', severity: 'high', title: 'A' }), finding({ ruleKey: 'b', severity: 'high', title: 'B' })],
    )

    expect(delta.carried.map((c) => c.severityChange)).toEqual(['worse', 'same'])
  })

  it('reports two unanalyzed versions as no change rather than as an improvement', () => {
    const delta = compareRiskFindings([], [])

    expect(delta.unchanged).toBe(true)
    expect(delta.counts).toEqual({ base: { high: 0, medium: 0, low: 0 }, revised: { high: 0, medium: 0, low: 0 } })
  })
})
