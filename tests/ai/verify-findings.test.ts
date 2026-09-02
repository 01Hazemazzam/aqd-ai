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
]

function finding(over: Partial<RawFinding> = {}): RawFinding {
  return {
    clauseId: 'c1',
    ruleKey: 'unlimited_liability',
    severity: 'high',
    title: 'Liability cap favours Provider',
    reason: 'The cap is limited to fees paid.',
    reasonAr: 'الحد الأقصى مقصور على الرسوم المدفوعة.',
    evidence: 'aggregate liability under this Agreement shall not exceed the fees paid',
    ...over,
  }
}

describe('verifyFindings', () => {
  it('keeps a finding whose evidence really appears in the cited clause', () => {
    const { kept, rejected } = verifyFindings([finding()], CLAUSES)
    expect(rejected).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(kept[0].evidence).toContain('aggregate liability')
  })

  it('rejects a fabricated quote that never appears in the clause', () => {
    // Reads plausibly, cites a real clause, and is entirely invented.
    const { kept, rejected } = verifyFindings(
      [finding({ evidence: 'Provider shall indemnify Customer without limitation' })],
      CLAUSES,
    )
    expect(kept).toHaveLength(0)
    expect(rejected[0].reason).toBe('evidence_not_in_clause')
  })

  it('rejects a finding citing a clause id it was never given', () => {
    const { kept, rejected } = verifyFindings([finding({ clauseId: 'c-does-not-exist' })], CLAUSES)
    expect(kept).toHaveLength(0)
    expect(rejected[0].reason).toBe('unknown_clause')
  })

  it('rejects an anchored finding that quotes nothing', () => {
    const { rejected } = verifyFindings([finding({ evidence: null })], CLAUSES)
    expect(rejected[0].reason).toBe('missing_evidence')
  })

  it('rejects a quote too short to be evidence of anything', () => {
    // "shall" appears in the clause, but matching it proves nothing.
    const { rejected } = verifyFindings([finding({ evidence: 'shall' })], CLAUSES)
    expect(rejected[0].reason).toBe('missing_evidence')
  })

  it('forgives reflowed whitespace and curly/straight quote differences', () => {
    const { kept } = verifyFindings(
      [finding({ evidence: "each party's   aggregate liability\nunder this Agreement" })],
      CLAUSES,
    )
    expect(kept).toHaveLength(1)
  })

  it('accepts an elided quote joined by an ellipsis, in order', () => {
    const { kept } = verifyFindings(
      [finding({ evidence: 'Limitation of Liability ... shall not exceed the fees paid' })],
      CLAUSES,
    )
    expect(kept).toHaveLength(1)
  })

  it('rejects an elided quote whose segments appear out of order', () => {
    const { rejected } = verifyFindings(
      [finding({ evidence: 'shall not exceed the fees paid ... Limitation of Liability' })],
      CLAUSES,
    )
    expect(rejected[0].reason).toBe('evidence_not_in_clause')
  })

  it('verifies Arabic evidence against an Arabic clause', () => {
    const { kept } = verifyFindings(
      [finding({ clauseId: 'c2', evidence: 'إنهاء هذه الاتفاقية بإشعار كتابي مدته ستون' })],
      CLAUSES,
    )
    expect(kept).toHaveLength(1)
  })

  it('rejects fabricated Arabic evidence', () => {
    const { rejected } = verifyFindings(
      [finding({ clauseId: 'c2', evidence: 'يحق للطرف الأول تعديل الاتفاقية دون موافقة' })],
      CLAUSES,
    )
    expect(rejected[0].reason).toBe('evidence_not_in_clause')
  })

  it('keeps a missing-clause finding, which has nothing to quote', () => {
    const { kept, rejected } = verifyFindings(
      [finding({ clauseId: null, ruleKey: 'governing_law', title: 'No governing law', evidence: null })],
      CLAUSES,
    )
    expect(rejected).toHaveLength(0)
    expect(kept[0].clauseId).toBeNull()
    expect(kept[0].evidence).toBeNull()
  })

  it('discards any quote attached to a missing-clause finding, since there is no source for it', () => {
    const { kept } = verifyFindings(
      [finding({ clauseId: null, evidence: 'text the document supposedly does not contain' })],
      CLAUSES,
    )
    expect(kept[0].evidence).toBeNull()
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

  it('keeps the good findings and drops only the ungrounded ones from a mixed batch', () => {
    const { kept, rejected } = verifyFindings(
      [
        finding(),
        finding({ title: 'Invented', evidence: 'no such words anywhere in this contract' }),
        finding({ clauseId: 'c2', evidence: 'إنهاء هذه الاتفاقية بإشعار كتابي' }),
      ],
      CLAUSES,
    )
    expect(kept.map((k) => k.title)).toEqual(['Liability cap favours Provider', 'Liability cap favours Provider'])
    expect(rejected).toHaveLength(1)
    expect(rejected[0].finding.title).toBe('Invented')
  })
})
