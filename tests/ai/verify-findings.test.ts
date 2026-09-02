// tests/ai/verify-findings.test.ts
//
// verifyFindings is the line between "the model said so" and "the document
// says so". The risk it guards against is NOT malformed output -- it is
// confident, well-formed, plausible-sounding fabrication: a finding whose
// reason reads perfectly and whose quote never appears in the contract.
// These lock that behaviour, and every case a real contract exposes should
// be added here rather than fixed by loosening the check.
import { describe, it, expect } from 'vitest'
import { verifyFindings, type RawFinding } from '@/lib/ai/verify-findings'

const CLAUSES = [
  {
    id: 'c1',
    body: 'Limitation of Liability. Except as stated below, each party’s aggregate liability under this Agreement shall not exceed the fees paid in the preceding twelve (12) months.',
  },
  {
    id: 'c2',
    body: 'الإنهاء. يجوز لأي من الطرفين إنهاء هذه الاتفاقية بإشعار كتابي مدته ستون (60) يوماً.',
  },
  {
    id: 'c3',
    body: 'Termination for Convenience. Customer may terminate for convenience after twelve (12) months on sixty (60) days notice. Provider has no equivalent right.',
  },
]

function finding(over: Partial<RawFinding> = {}): RawFinding {
  return {
    kind: 'playbook',
    ruleKey: 'unlimited_liability',
    severity: 'high',
    title: 'Liability cap favours Provider',
    reason: 'The cap is limited to fees paid.',
    reasonAr: 'الحد الأقصى مقصور على الرسوم المدفوعة.',
    evidence: [{ clauseId: 'c1', quote: 'aggregate liability under this Agreement shall not exceed the fees paid' }],
    ...over,
  }
}

describe('verifyFindings', () => {
  it('keeps a finding whose evidence really appears in the cited clause', () => {
    const { kept, rejected } = verifyFindings([finding()], CLAUSES)
    expect(rejected).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(kept[0].evidence[0].quote).toContain('aggregate liability')
    // The anchor is the first quoted clause, which is what the reader's
    // severity gutter marks.
    expect(kept[0].clauseId).toBe('c1')
  })

  it('rejects a fabricated quote that never appears in the clause', () => {
    // Reads plausibly, cites a real clause, and is entirely invented.
    const { kept, rejected } = verifyFindings(
      [finding({ evidence: [{ clauseId: 'c1', quote: 'Provider shall indemnify Customer without limitation' }] })],
      CLAUSES,
    )
    expect(kept).toHaveLength(0)
    expect(rejected[0].reason).toBe('evidence_not_in_clause')
  })

  it('rejects a finding citing a clause id it was never given', () => {
    const { kept, rejected } = verifyFindings(
      [finding({ evidence: [{ clauseId: 'c-does-not-exist', quote: 'aggregate liability under this Agreement' }] })],
      CLAUSES,
    )
    expect(kept).toHaveLength(0)
    expect(rejected[0].reason).toBe('unknown_clause')
  })

  it('rejects a span that quotes nothing', () => {
    const { rejected } = verifyFindings([finding({ evidence: [{ clauseId: 'c1', quote: null }] })], CLAUSES)
    expect(rejected[0].reason).toBe('missing_evidence')
  })

  it('rejects a quote too short to be evidence of anything', () => {
    // "shall" appears in the clause, but matching it proves nothing.
    const { rejected } = verifyFindings([finding({ evidence: [{ clauseId: 'c1', quote: 'shall' }] })], CLAUSES)
    expect(rejected[0].reason).toBe('missing_evidence')
  })

  it('forgives reflowed whitespace and curly/straight quote differences', () => {
    const { kept } = verifyFindings(
      [finding({ evidence: [{ clauseId: 'c1', quote: "each party's   aggregate liability\nunder this Agreement" }] })],
      CLAUSES,
    )
    expect(kept).toHaveLength(1)
  })

  it('accepts an elided quote joined by an ellipsis, in order', () => {
    const { kept } = verifyFindings(
      [finding({ evidence: [{ clauseId: 'c1', quote: 'Limitation of Liability ... shall not exceed the fees paid' }] })],
      CLAUSES,
    )
    expect(kept).toHaveLength(1)
  })

  it('rejects an elided quote whose segments appear out of order', () => {
    const { rejected } = verifyFindings(
      [finding({ evidence: [{ clauseId: 'c1', quote: 'shall not exceed the fees paid ... Limitation of Liability' }] })],
      CLAUSES,
    )
    expect(rejected[0].reason).toBe('evidence_not_in_clause')
  })

  it('verifies Arabic evidence against an Arabic clause', () => {
    const { kept } = verifyFindings(
      [finding({ evidence: [{ clauseId: 'c2', quote: 'إنهاء هذه الاتفاقية بإشعار كتابي مدته ستون' }] })],
      CLAUSES,
    )
    expect(kept).toHaveLength(1)
  })

  it('rejects fabricated Arabic evidence', () => {
    const { rejected } = verifyFindings(
      [finding({ evidence: [{ clauseId: 'c2', quote: 'يحق للطرف الأول تعديل الاتفاقية دون موافقة' }] })],
      CLAUSES,
    )
    expect(rejected[0].reason).toBe('evidence_not_in_clause')
  })

  it('keeps a missing-clause finding, which has nothing to quote', () => {
    const { kept, rejected } = verifyFindings(
      [finding({ ruleKey: 'governing_law', title: 'No governing law', evidence: [] })],
      CLAUSES,
    )
    expect(rejected).toHaveLength(0)
    expect(kept[0].clauseId).toBeNull()
    expect(kept[0].evidence).toEqual([])
  })

  it('rejects an out-of-range severity rather than coercing it', () => {
    const { rejected } = verifyFindings([finding({ severity: 'critical' })], CLAUSES)
    expect(rejected[0].reason).toBe('bad_severity')
  })

  it('rejects a finding with no title or no reason', () => {
    expect(verifyFindings([finding({ title: '  ' })], CLAUSES).rejected[0].reason).toBe('empty_content')
    expect(verifyFindings([finding({ reason: '' })], CLAUSES).rejected[0].reason).toBe('empty_content')
  })

  it('normalises an absent reasonAr to null instead of an empty string', () => {
    const { kept } = verifyFindings([finding({ reasonAr: '   ' })], CLAUSES)
    expect(kept[0].reasonAr).toBeNull()
  })

  it('falls back to the playbook kind rather than dropping a finding over an unknown label', () => {
    const { kept } = verifyFindings([finding({ kind: 'vibes' })], CLAUSES)
    expect(kept[0].kind).toBe('playbook')
  })

  it('keeps the good findings and drops only the ungrounded ones from a mixed batch', () => {
    const { kept, rejected } = verifyFindings(
      [
        finding(),
        finding({ title: 'Invented', evidence: [{ clauseId: 'c1', quote: 'no such words anywhere in this contract' }] }),
        finding({ evidence: [{ clauseId: 'c2', quote: 'إنهاء هذه الاتفاقية بإشعار كتابي' }] }),
      ],
      CLAUSES,
    )
    expect(kept.map((k) => k.title)).toEqual(['Liability cap favours Provider', 'Liability cap favours Provider'])
    expect(rejected).toHaveLength(1)
    expect(rejected[0].finding.title).toBe('Invented')
  })
})

// A cross-clause finding claims something about how two clauses RELATE. Its
// failure mode is different from a fabricated quote: the model can quote both
// clauses accurately and still invent the relationship, or -- far more
// commonly -- assert an asymmetry while only being able to quote the half
// that supports it. Requiring both sides is what makes the claim checkable.
describe('verifyFindings :: cross-clause findings', () => {
  function relational(over: Partial<RawFinding> = {}): RawFinding {
    return finding({
      kind: 'asymmetry',
      ruleKey: null,
      title: 'Termination for convenience is one-sided',
      reason: 'Customer may exit at will; the provider has no equivalent right.',
      evidence: [
        { clauseId: 'c3', quote: 'Customer may terminate for convenience after twelve (12) months' },
        { clauseId: 'c1', quote: 'aggregate liability under this Agreement shall not exceed the fees paid' },
      ],
      ...over,
    })
  }

  it('keeps a finding that quotes both clauses it relates', () => {
    const { kept, rejected } = verifyFindings([relational()], CLAUSES)
    expect(rejected).toHaveLength(0)
    expect(kept[0].kind).toBe('asymmetry')
    expect(kept[0].evidence).toHaveLength(2)
    expect(kept[0].evidence.map((e) => e.clauseId)).toEqual(['c3', 'c1'])
  })

  // Regression, from a live run against the balanced QA fixture. An earlier
  // version required every relational finding to quote two DIFFERENT clauses,
  // and threw away the single most valuable finding on that contract: the
  // termination clause states its own one-sidedness outright, so the whole
  // asymmetry is inside one clause and there is no second clause to cite.
  // Requiring two there swapped a false positive for a false negative on the
  // clearest evidence a contract can give.
  it('keeps an asymmetry a single clause states both sides of', () => {
    const { kept, rejected } = verifyFindings(
      [
        relational({
          evidence: [{ clauseId: 'c3', quote: 'Customer may terminate for convenience after twelve (12) months' }],
        }),
      ],
      CLAUSES,
    )
    expect(rejected).toHaveLength(0)
    expect(kept[0].kind).toBe('asymmetry')
  })

  it('rejects a contradiction supported by only one clause', () => {
    // Two clauses saying incompatible things cannot be shown from one of
    // them, however accurately that one is quoted.
    const { kept, rejected } = verifyFindings(
      [
        relational({
          kind: 'contradiction',
          evidence: [{ clauseId: 'c3', quote: 'Customer may terminate for convenience after twelve' }],
        }),
      ],
      CLAUSES,
    )
    expect(kept).toHaveLength(0)
    expect(rejected[0].reason).toBe('insufficient_spans')
  })

  it('rejects a dependency that quotes the same clause twice', () => {
    const { rejected } = verifyFindings(
      [
        relational({
          kind: 'dependency',
          evidence: [
            { clauseId: 'c3', quote: 'Customer may terminate for convenience after twelve' },
            { clauseId: 'c3', quote: 'Provider has no equivalent right' },
          ],
        }),
      ],
      CLAUSES,
    )
    expect(rejected[0].reason).toBe('insufficient_spans')
  })

  it('rejects a relational claim with no evidence at all, which a missing clause cannot excuse', () => {
    const { rejected } = verifyFindings([relational({ evidence: [] })], CLAUSES)
    expect(rejected[0].reason).toBe('insufficient_spans')
  })

  it('drops the whole finding when one of its two quotes is fabricated', () => {
    // Keeping the verifiable half would present an invented relationship as
    // partially sourced, which is worse than reporting nothing.
    const { kept, rejected } = verifyFindings(
      [
        relational({
          evidence: [
            { clauseId: 'c3', quote: 'Customer may terminate for convenience after twelve (12) months' },
            { clauseId: 'c1', quote: 'Provider may terminate at any time without notice' },
          ],
        }),
      ],
      CLAUSES,
    )
    expect(kept).toHaveLength(0)
    expect(rejected[0].reason).toBe('evidence_not_in_clause')
  })

  it('relates an Arabic clause to an English one', () => {
    const { kept } = verifyFindings(
      [
        relational({
          kind: 'contradiction',
          evidence: [
            { clauseId: 'c2', quote: 'إنهاء هذه الاتفاقية بإشعار كتابي مدته ستون' },
            { clauseId: 'c3', quote: 'sixty (60) days notice. Provider has no equivalent right' },
          ],
        }),
      ],
      CLAUSES,
    )
    expect(kept).toHaveLength(1)
    expect(kept[0].kind).toBe('contradiction')
  })
})
