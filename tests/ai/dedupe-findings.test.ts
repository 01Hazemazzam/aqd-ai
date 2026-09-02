// tests/ai/dedupe-findings.test.ts
//
// Discovered live: re-analysing Aqd_AI_QA_Stress_Test_Contract produced three
// playbook findings (clauses 11, 12, 13) and three cross-clause findings on
// exactly the same three clauses -- six rows for three risks. These lock the
// rule that separates a relational finding which adds something from one
// that only re-words a playbook finding.
import { describe, it, expect } from 'vitest'
import { dropRedundantRelational } from '@/lib/ai/dedupe-findings'
import type { VerifiedFinding } from '@/lib/ai/verify-findings'

function finding(over: Partial<VerifiedFinding> & { clauses?: string[] } = {}): VerifiedFinding {
  const { clauses = ['c1'], ...rest } = over
  return {
    kind: 'playbook',
    clauseId: clauses[0] ?? null,
    ruleKey: null,
    severity: 'high',
    title: 'A finding',
    reason: 'Because.',
    reasonAr: null,
    evidence: clauses.map((id) => ({ clauseId: id, quote: `words from ${id}` })),
    ...rest,
  }
}

describe('dropRedundantRelational', () => {
  it('drops a relational finding that cites only a clause the playbook pass already reported', () => {
    const { kept, dropped } = dropRedundantRelational([
      finding({ title: 'One-Sided Indemnification', clauses: ['c12'] }),
      finding({ kind: 'asymmetry', title: 'Broad Customer Indemnity', clauses: ['c12'] }),
    ])
    expect(kept.map((f) => f.title)).toEqual(['One-Sided Indemnification'])
    expect(dropped.map((f) => f.title)).toEqual(['Broad Customer Indemnity'])
  })

  it('keeps a relational finding that combines two clauses reported separately', () => {
    // This is the finding the cross-clause pass exists for: neither
    // single-clause finding can say how the cap and the indemnity interact.
    const { kept, dropped } = dropRedundantRelational([
      finding({ title: 'Unlimited Liability', clauses: ['c11'] }),
      finding({ title: 'One-Sided Indemnification', clauses: ['c12'] }),
      finding({ kind: 'asymmetry', title: 'Cap swallowed by indemnity', clauses: ['c11', 'c12'] }),
    ])
    expect(dropped).toHaveLength(0)
    expect(kept).toHaveLength(3)
  })

  it('keeps a relational finding about clauses the playbook pass never touched', () => {
    const { kept } = dropRedundantRelational([
      finding({ title: 'Unlimited Liability', clauses: ['c11'] }),
      finding({ kind: 'contradiction', title: 'Conflicting notice periods', clauses: ['c6', 'c16'] }),
    ])
    expect(kept).toHaveLength(2)
  })

  it('keeps a relational finding that shares one clause but reaches beyond it', () => {
    const { kept } = dropRedundantRelational([
      finding({ title: 'Unlimited Liability', clauses: ['c11'] }),
      finding({ kind: 'dependency', title: 'Cap undercut elsewhere', clauses: ['c11', 'c25'] }),
    ])
    expect(kept).toHaveLength(2)
  })

  it('never drops a playbook finding, even one duplicating another playbook finding', () => {
    // Deduplicating the playbook pass against itself is a different question
    // with a different answer -- two rules can legitimately fire on one
    // clause, and this module deliberately does not touch that.
    const { kept, dropped } = dropRedundantRelational([
      finding({ title: 'First', clauses: ['c1'] }),
      finding({ title: 'Second', clauses: ['c1'] }),
    ])
    expect(kept).toHaveLength(2)
    expect(dropped).toHaveLength(0)
  })

  it('keeps an unanchored relational finding, which cannot be shown to duplicate anything', () => {
    const { kept } = dropRedundantRelational([
      finding({ title: 'Unlimited Liability', clauses: ['c11'] }),
      finding({ kind: 'asymmetry', title: 'Unanchored', clauses: [], clauseId: null }),
    ])
    expect(kept).toHaveLength(2)
  })

  it('leaves a run with no relational findings exactly as it found it', () => {
    const input = [finding({ clauses: ['c1'] }), finding({ clauses: ['c2'] })]
    const { kept, dropped } = dropRedundantRelational(input)
    expect(kept).toEqual(input)
    expect(dropped).toHaveLength(0)
  })
})
