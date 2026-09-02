// tests/intelligence/build.test.ts
//
// buildIntelligence turns analysed contracts into the operational layer. The
// properties worth pinning are the ones that keep it honest: nothing dated
// without a derivation, nothing on the calendar the contract did not support,
// and an attention item only where a risk and a duty genuinely share a clause.
import { describe, it, expect } from 'vitest'
import { buildIntelligence, type InputContract } from '@/lib/intelligence/build'
import type { DueSpec } from '@/lib/intelligence/due-spec'

const TODAY = new Date('2028-03-15T00:00:00Z')

function renewalSpec(offset = 60): DueSpec {
  return {
    verbatim: `at least ${offset} days before the end of the then-current term`,
    offset,
    unit: 'day',
    direction: 'before',
    anchor: 'term_end',
    anchorDate: null,
  }
}

const EVENT_SPEC: DueSpec = {
  verbatim: 'within thirty (30) days after receipt',
  offset: 30,
  unit: 'day',
  direction: 'after',
  anchor: 'contract_event',
  anchorDate: null,
}

function contract(over: Partial<InputContract> = {}): InputContract {
  return {
    contractId: 'c1',
    title: 'Orion Managed Services',
    effectiveDate: '1 September 2026',
    termLength: 'twenty-one (21) months', // ends 2028-05-31
    parties: ['Orion Ledger Technologies W.L.L.', 'Gulf Wholesale Trading'],
    findings: [],
    obligations: [],
    current: true,
    ...over,
  }
}

describe('buildIntelligence :: lifecycle calendar', () => {
  it('places the effective date and the initial term end on the calendar', () => {
    const { milestones } = buildIntelligence([contract()], TODAY)
    expect(milestones.map((m) => [m.kind, m.date])).toEqual([
      ['effective_date', '2026-09-01'],
      ['term_end', '2028-05-31'],
    ])
  })

  it('explains where the term end came from instead of just asserting it', () => {
    const { milestones } = buildIntelligence([contract()], TODAY)
    const termEnd = milestones.find((m) => m.kind === 'term_end')
    expect(termEnd?.derivation).toMatchObject({ anchor: 'effective_date', anchorDate: '2026-09-01' })
    // The document's own wording for the term, not a month count it never wrote.
    expect(termEnd?.termLength).toBe('twenty-one (21) months')
  })

  it('places nothing when the contract states no dates', () => {
    const { milestones } = buildIntelligence([contract({ effectiveDate: null, termLength: null })], TODAY)
    expect(milestones).toEqual([])
  })

  it('sorts the whole portfolio chronologically across contracts', () => {
    const other = contract({ contractId: 'c2', title: 'Later Deal', effectiveDate: '15 April 2027', termLength: '24 months' })
    const { milestones } = buildIntelligence([other, contract()], TODAY)
    expect(milestones.map((m) => m.date)).toEqual(['2026-09-01', '2027-04-15', '2028-05-31', '2029-04-14'])
  })

  it('buckets each milestone by urgency against today', () => {
    const { milestones } = buildIntelligence([contract()], TODAY)
    // 2026-09-01 is past; 2028-05-31 is 77 days out, so upcoming not soon.
    expect(milestones.map((m) => m.urgency)).toEqual(['overdue', 'upcoming'])
  })

  // The calendar reads this to decide whether a past date deserves an
  // "Overdue" badge. Marking a contract's start date late would badge every
  // running contract in the portfolio.
  it('marks lifecycle dates as unmissable and obligation deadlines as missable', () => {
    const c = contract({
      obligations: [{ clauseId: 'cl4', obligor: 'Each party', action: 'Give notice', due: renewalSpec().verbatim, dueSpec: renewalSpec() }],
    })
    const { milestones } = buildIntelligence([c], TODAY)
    const missableByKind = Object.fromEntries(milestones.map((m) => [m.kind, m.missable]))
    expect(missableByKind).toEqual({ effective_date: false, term_end: false, obligation: true })
  })
})

describe('buildIntelligence :: obligation deadlines', () => {
  it('puts a resolved renewal-notice deadline on the calendar with its arithmetic', () => {
    const c = contract({
      obligations: [
        { clauseId: 'cl4', obligor: 'Each party', action: 'Give notice of non-renewal', due: renewalSpec().verbatim, dueSpec: renewalSpec() },
      ],
    })
    const { milestones } = buildIntelligence([c], TODAY)
    const ob = milestones.find((m) => m.kind === 'obligation')
    expect(ob?.date).toBe('2028-04-01')
    expect(ob?.derivation).toMatchObject({ anchor: 'term_end', anchorDate: '2028-05-31', direction: 'before', offset: 60, unit: 'day' })
    expect(ob?.urgency).toBe('soon') // 17 days from 2028-03-15
  })

  it('keeps an event-anchored obligation off the calendar entirely', () => {
    const c = contract({
      obligations: [{ clauseId: 'cl9', obligor: 'Provider', action: 'Refund overpayment', due: EVENT_SPEC.verbatim, dueSpec: EVENT_SPEC }],
    })
    const { milestones, obligations, counts } = buildIntelligence([c], TODAY)
    expect(milestones.filter((m) => m.kind === 'obligation')).toEqual([])
    // Still tracked, and it says why it has no date.
    expect(obligations[0].resolution.status).toBe('unresolved')
    expect(obligations[0].resolution.reason).toBe('anchor_not_dated')
    expect(counts.unresolvedDeadlines).toBe(1)
  })

  it('tracks an obligation with no stated timing without inventing one', () => {
    const c = contract({ obligations: [{ clauseId: 'cl9', obligor: 'Provider', action: 'Maintain records', due: null }] })
    const { obligations, milestones } = buildIntelligence([c], TODAY)
    expect(obligations[0].resolution.status).toBe('no_deadline_stated')
    expect(milestones.filter((m) => m.kind === 'obligation')).toEqual([])
  })
})

describe('buildIntelligence :: party roles', () => {
  it('maps an obligor onto the contract’s own parties', () => {
    const c = contract({
      obligations: [
        { clauseId: 'a', obligor: 'Orion Ledger', action: 'Provide the Services', due: null },
        { clauseId: 'b', obligor: 'Gulf Wholesale Trading', action: 'Pay the fees', due: null },
      ],
    })
    const { obligations } = buildIntelligence([c], TODAY)
    expect(obligations.map((o) => o.role)).toEqual(['party_a', 'party_b'])
  })

  it('recognises a mutual obligation as owed by both, in either language', () => {
    const c = contract({
      obligations: [
        { clauseId: 'a', obligor: 'Each party', action: 'Protect confidential information', due: null },
        { clauseId: 'b', obligor: 'either party', action: 'Terminate for cause', due: null },
        { clauseId: 'c', obligor: 'الطرفان', action: 'الالتزام بالسرية', due: null },
      ],
    })
    const { obligations } = buildIntelligence([c], TODAY)
    expect(obligations.map((o) => o.role)).toEqual(['both', 'both', 'both'])
  })

  it('leaves an obligor it cannot place unmapped rather than guessing a party', () => {
    const c = contract({ obligations: [{ clauseId: 'a', obligor: 'Provider', action: 'Host the platform', due: null }] })
    // "Provider" is a defined term, not a party name -- only the extractor,
    // reading the definitions clause, can bridge that.
    expect(buildIntelligence([c], TODAY).obligations[0].role).toBeNull()
  })

  it('prefers the extractor’s role over the fallback', () => {
    const c = contract({ obligations: [{ clauseId: 'a', obligor: 'Provider', action: 'Host', due: null, partyRole: 'party_a' }] })
    expect(buildIntelligence([c], TODAY).obligations[0].role).toBe('party_a')
  })
})

describe('buildIntelligence :: attention items where risk meets duty', () => {
  const RISKY_DUTY = contract({
    findings: [
      { id: 'f1', clauseId: 'cl12', kind: 'playbook', severity: 'high', title: 'One-sided indemnity' },
      { id: 'f2', clauseId: 'cl30', kind: 'playbook', severity: 'low', title: 'No dispute clause' },
    ],
    obligations: [
      { clauseId: 'cl12', obligor: 'Gulf Wholesale Trading', action: 'Indemnify the provider', due: null },
      { clauseId: 'cl99', obligor: 'Orion Ledger', action: 'Publish uptime reports', due: null },
    ],
  })

  it('pairs an obligation with a finding only when they share a clause', () => {
    const { attention } = buildIntelligence([RISKY_DUTY], TODAY)
    expect(attention).toHaveLength(1)
    expect(attention[0].clauseId).toBe('cl12')
    expect(attention[0].findingTitle).toBe('One-sided indemnity')
    expect(attention[0].action).toBe('Indemnify the provider')
  })

  it('does not invent a pairing from a finding on a clause with no obligation', () => {
    const { attention } = buildIntelligence([RISKY_DUTY], TODAY)
    expect(attention.map((a) => a.clauseId)).not.toContain('cl30')
  })

  it('pairs against the most serious finding when a clause carries several', () => {
    const c = contract({
      findings: [
        { id: 'f1', clauseId: 'cl12', kind: 'playbook', severity: 'medium', title: 'Medium thing' },
        { id: 'f2', clauseId: 'cl12', kind: 'asymmetry', severity: 'high', title: 'High thing' },
      ],
      obligations: [{ clauseId: 'cl12', obligor: 'Each party', action: 'Do the thing', due: null }],
    })
    expect(buildIntelligence([c], TODAY).attention[0].findingTitle).toBe('High thing')
  })

  it('ranks worst severity first, then soonest', () => {
    const c = contract({
      findings: [
        { id: 'f1', clauseId: 'a', kind: 'playbook', severity: 'medium', title: 'Medium' },
        { id: 'f2', clauseId: 'b', kind: 'playbook', severity: 'high', title: 'High undated' },
        { id: 'f3', clauseId: 'c', kind: 'playbook', severity: 'high', title: 'High soon' },
      ],
      obligations: [
        { clauseId: 'a', obligor: 'x', action: 'a', due: null },
        { clauseId: 'b', obligor: 'x', action: 'b', due: null },
        { clauseId: 'c', obligor: 'x', action: 'c', due: renewalSpec().verbatim, dueSpec: renewalSpec() },
      ],
    })
    expect(buildIntelligence([c], TODAY).attention.map((a) => a.findingTitle)).toEqual(['High soon', 'High undated', 'Medium'])
  })
})

describe('buildIntelligence :: contract ranking', () => {
  it('ranks a contract with a high-severity duty due soon above one merely carrying risk', () => {
    const urgent = contract({
      contractId: 'urgent',
      title: 'Urgent',
      findings: [{ id: 'f', clauseId: 'cl4', kind: 'playbook', severity: 'high', title: 'Auto-renewal trap' }],
      obligations: [{ clauseId: 'cl4', obligor: 'Each party', action: 'Give notice', due: renewalSpec().verbatim, dueSpec: renewalSpec() }],
    })
    const quiet = contract({
      contractId: 'quiet',
      title: 'Quiet',
      findings: [{ id: 'g', clauseId: 'cl7', kind: 'playbook', severity: 'high', title: 'Unlimited liability' }],
      obligations: [{ clauseId: 'cl7', obligor: 'Provider', action: 'Carry the risk', due: null }],
    })
    const { contracts } = buildIntelligence([quiet, urgent], TODAY)
    expect(contracts.map((c) => [c.contractId, c.tier])).toEqual([
      ['urgent', 'due_soon_high_risk'],
      ['quiet', 'high_risk_undated'],
    ])
  })

  // Regression: a contract whose effective date has passed was being ranked
  // "overdue", which is every running contract. Only a duty can be missed --
  // a contract starting, or entering a renewal period, is not a missed action.
  it('does not call a contract overdue merely because it has already started', () => {
    const started = contract({ contractId: 'started', title: 'Started' })
    const { contracts, counts } = buildIntelligence([started], TODAY)
    expect(contracts[0].tier).toBe('monitored')
    expect(counts.overdue).toBe(0)
  })

  it('does call a contract overdue when a duty’s own deadline has passed', () => {
    const missed = contract({
      obligations: [
        { clauseId: 'cl4', obligor: 'Each party', action: 'Give notice', due: renewalSpec(400).verbatim, dueSpec: renewalSpec(400) },
      ],
    })
    const { contracts, counts } = buildIntelligence([missed], TODAY)
    expect(contracts[0].tier).toBe('overdue') // 2028-05-31 minus 400 days = 2027-04-27
    expect(counts.overdue).toBe(1)
  })

  it('marks a contract with nothing outstanding as monitored', () => {
    const { contracts } = buildIntelligence([contract({ effectiveDate: null, termLength: null })], TODAY)
    expect(contracts[0].tier).toBe('monitored')
  })

  it('names the next upcoming date, skipping ones already behind us', () => {
    const { contracts } = buildIntelligence([contract()], TODAY)
    // Effective date 2026-09-01 is past; the term end is next.
    expect(contracts[0].nextDate).toBe('2028-05-31')
  })

  it('counts contracts whose analysis predates the deadline schema', () => {
    const { counts, contracts } = buildIntelligence([contract({ current: false })], TODAY)
    expect(counts.outdated).toBe(1)
    expect(contracts[0].current).toBe(false)
  })
})
