// tests/ai/verify-obligations.test.ts
//
// A due specification is mostly numbers and enum values, which is what makes
// it dangerous: mis-reading "sixty (60) days AFTER termination" as "BEFORE
// the term end" yields a well-formed record that resolves to a confident,
// wrong date on a legal calendar. Nothing about the output looks wrong. These
// pin the checks that catch it, and the rule that a bad specification costs
// the obligation its date but never the obligation itself.
import { describe, it, expect } from 'vitest'
import { verifyObligations, type RawObligation } from '@/lib/ai/verify-obligations'

const CLAUSES = [
  {
    id: 'c4',
    body: 'Renewal. After the initial term, the Agreement automatically renews for successive twelve (12) month periods unless either party gives written notice of non-renewal at least sixty (60) days before the end of the then-current term.',
  },
  {
    id: 'c15',
    body: 'Data Export. Customer may request an export of Customer Data during the term and for thirty (30) days after termination.',
  },
  {
    id: 'c9',
    body: 'الإنهاء. يلتزم المورّد بإخطار العميل خلال ثلاثين (٣٠) يوماً من تاريخ الإنهاء.',
  },
]

function obligation(over: Partial<RawObligation> = {}): RawObligation {
  return {
    clauseId: 'c4',
    obligor: 'either party',
    partyRole: 'both',
    action: 'Give written notice of non-renewal',
    due: 'at least sixty (60) days before the end of the then-current term',
    dueSpec: {
      verbatim: 'at least sixty (60) days before the end of the then-current term',
      offset: 60,
      unit: 'day',
      direction: 'before',
      anchor: 'term_end',
      anchorDate: null,
    },
    ...over,
  }
}

describe('verifyObligations', () => {
  it('keeps a specification whose phrase and number are both really in the clause', () => {
    const { obligations, droppedSpecs } = verifyObligations([obligation()], CLAUSES)
    expect(droppedSpecs).toHaveLength(0)
    expect(obligations[0].dueSpec).toMatchObject({ offset: 60, unit: 'day', direction: 'before', anchor: 'term_end' })
    expect(obligations[0].partyRole).toBe('both')
  })

  it('drops a specification whose phrase is not in the cited clause', () => {
    const { obligations, droppedSpecs } = verifyObligations(
      [obligation({ dueSpec: { ...obligation().dueSpec, verbatim: 'within fourteen (14) days of the invoice date' } })],
      CLAUSES,
    )
    expect(droppedSpecs[0].reason).toBe('verbatim_not_in_clause')
    // The obligation survives without a date -- a true statement, where the
    // date would have been an invented one.
    expect(obligations).toHaveLength(1)
    expect(obligations[0].dueSpec).toBeNull()
    expect(obligations[0].action).toBe('Give written notice of non-renewal')
  })

  it('drops a specification whose number is nowhere in the phrase it quoted', () => {
    // The phrase is genuine; the figure is not the phrase's figure. This is
    // the failure that produces a confident wrong date.
    const { droppedSpecs } = verifyObligations([obligation({ dueSpec: { ...obligation().dueSpec, offset: 90 } })], CLAUSES)
    expect(droppedSpecs[0].reason).toBe('offset_not_in_phrase')
  })

  it('accepts a number the clause writes only in words', () => {
    const { obligations } = verifyObligations(
      [
        obligation({
          clauseId: 'c15',
          action: 'Export customer data',
          dueSpec: {
            verbatim: 'thirty (30) days after termination',
            offset: 30,
            unit: 'day',
            direction: 'after',
            anchor: 'contract_event',
            anchorDate: null,
          },
        }),
      ],
      CLAUSES,
    )
    expect(obligations[0].dueSpec?.anchor).toBe('contract_event')
  })

  it('verifies an Arabic clause, folding Arabic-Indic digits', () => {
    const { obligations, droppedSpecs } = verifyObligations(
      [
        obligation({
          clauseId: 'c9',
          obligor: 'المورّد',
          partyRole: 'party_a',
          action: 'إخطار العميل',
          dueSpec: {
            verbatim: 'خلال ثلاثين (٣٠) يوماً من تاريخ الإنهاء',
            offset: 30,
            unit: 'day',
            direction: 'after',
            anchor: 'contract_event',
            anchorDate: null,
          },
        }),
      ],
      CLAUSES,
    )
    expect(droppedSpecs).toHaveLength(0)
    expect(obligations[0].dueSpec?.offset).toBe(30)
  })

  // Regression, from a live run: Arabic writes periods as words at least as
  // often as numerals, and corroborating the offset against English words
  // alone rejected every such deadline -- a false negative on exactly the
  // clauses an Arabic-first product exists to read.
  it('corroborates an offset an Arabic clause spells out in words', () => {
    const clauses = [
      { id: 'ar1', body: 'يلتزم المورّد بإخطار العميل خلال ست وثلاثين ساعة من تأكيد الحادث الأمني.' },
      { id: 'ar2', body: 'يلتزم المورّد بحذف بيانات العميل خلال خمسة وأربعين يوماً بعد انتهاء الفترة.' },
    ]
    const spec = (verbatim: string, offset: number) => ({
      verbatim,
      offset,
      unit: 'hour' as const,
      direction: 'after' as const,
      anchor: 'contract_event',
      anchorDate: null,
    })

    const a = verifyObligations([obligation({ clauseId: 'ar1', dueSpec: spec('خلال ست وثلاثين ساعة', 36) })], clauses)
    expect(a.droppedSpecs).toHaveLength(0)
    expect(a.obligations[0].dueSpec?.offset).toBe(36)

    const b = verifyObligations([obligation({ clauseId: 'ar2', dueSpec: spec('خلال خمسة وأربعين يوماً', 45) })], clauses)
    expect(b.droppedSpecs).toHaveLength(0)
  })

  it('still rejects an Arabic offset the phrase does not spell out', () => {
    // "ثلاثين" is thirty; claiming thirty-six from it needs the units word
    // too, which is what keeps the check meaningful rather than decorative.
    const clauses = [{ id: 'ar1', body: 'يلتزم المورّد بالإخطار خلال ثلاثين يوماً من الطلب.' }]
    const { droppedSpecs } = verifyObligations(
      [
        obligation({
          clauseId: 'ar1',
          dueSpec: { verbatim: 'خلال ثلاثين يوماً', offset: 36, unit: 'day', direction: 'after', anchor: 'contract_event', anchorDate: null },
        }),
      ],
      clauses,
    )
    expect(droppedSpecs[0].reason).toBe('offset_not_in_phrase')
  })

  // Regression, and the most valuable check in this file. A live run returned
  // "for four (4) years after termination" and "For thirty (30) days after
  // termination" both anchored to term_end, and they resolved to confident,
  // precise, WRONG dates -- two of the three dates the calendar would have
  // shown. Termination is an event (a contract can be terminated early, or
  // renew several times first); the term expiring is a schedule. Nothing about
  // the record looks wrong, which is why it needs checking rather than trust.
  it('refuses to treat "after termination" as the end of the term', () => {
    const clauses = [
      { id: 'c23', body: 'Transition Assistance. For thirty (30) days after termination, Provider shall provide reasonable transition assistance.' },
    ]
    const { obligations } = verifyObligations(
      [
        obligation({
          clauseId: 'c23',
          action: 'Provide transition assistance',
          dueSpec: {
            verbatim: 'For thirty (30) days after termination',
            offset: 30,
            unit: 'day',
            direction: 'after',
            anchor: 'term_end',
            anchorDate: null,
          },
        }),
      ],
      clauses,
    )
    // Downgraded, not discarded: the timing phrase is still worth showing,
    // it just no longer yields a date.
    expect(obligations[0].dueSpec?.anchor).toBe('contract_event')
    expect(obligations[0].dueSpec?.verbatim).toBe('For thirty (30) days after termination')
  })

  it('keeps a genuine term-end anchor, which names the term rather than termination', () => {
    const { obligations } = verifyObligations([obligation()], CLAUSES)
    expect(obligations[0].dueSpec?.anchor).toBe('term_end')
  })

  it('downgrades a term-end anchor whose phrase never mentions the term at all', () => {
    const clauses = [{ id: 'x', body: 'Reports. Provider shall deliver a report within ten (10) days after each request.' }]
    const { obligations } = verifyObligations(
      [
        obligation({
          clauseId: 'x',
          dueSpec: { verbatim: 'within ten (10) days after each request', offset: 10, unit: 'day', direction: 'after', anchor: 'term_end', anchorDate: null },
        }),
      ],
      clauses,
    )
    expect(obligations[0].dueSpec?.anchor).toBe('contract_event')
  })

  it('downgrades an effective-date anchor the phrase does not support', () => {
    const clauses = [{ id: 'x', body: 'Invoices. Customer shall pay within twenty (20) days after receipt of an invoice.' }]
    const { obligations } = verifyObligations(
      [
        obligation({
          clauseId: 'x',
          dueSpec: { verbatim: 'within twenty (20) days after receipt', offset: 20, unit: 'day', direction: 'after', anchor: 'effective_date', anchorDate: null },
        }),
      ],
      clauses,
    )
    expect(obligations[0].dueSpec?.anchor).toBe('contract_event')
  })

  it('keeps an effective-date anchor whose phrase names the effective date', () => {
    const clauses = [{ id: 'x', body: 'Onboarding. Provider shall complete setup within ten (10) days after the Effective Date.' }]
    const { obligations } = verifyObligations(
      [
        obligation({
          clauseId: 'x',
          dueSpec: { verbatim: 'within ten (10) days after the Effective Date', offset: 10, unit: 'day', direction: 'after', anchor: 'effective_date', anchorDate: null },
        }),
      ],
      clauses,
    )
    expect(obligations[0].dueSpec?.anchor).toBe('effective_date')
  })

  it('refuses an Arabic termination phrase as a term-end anchor', () => {
    const clauses = [{ id: 'ar', body: 'يلتزم المورّد بحذف بيانات العميل خلال ثلاثين (30) يوماً بعد الإنهاء.' }]
    const { obligations } = verifyObligations(
      [
        obligation({
          clauseId: 'ar',
          dueSpec: { verbatim: 'خلال ثلاثين (30) يوماً بعد الإنهاء', offset: 30, unit: 'day', direction: 'after', anchor: 'term_end', anchorDate: null },
        }),
      ],
      clauses,
    )
    expect(obligations[0].dueSpec?.anchor).toBe('contract_event')
  })

  it('rejects an anchor, unit, or direction outside the closed sets', () => {
    for (const bad of [
      { anchor: 'renewal_boundary' },
      { unit: 'fortnight' },
      { direction: 'around' },
    ]) {
      const { droppedSpecs } = verifyObligations([obligation({ dueSpec: { ...obligation().dueSpec, ...bad } })], CLAUSES)
      expect(droppedSpecs[0].reason).toBe('bad_enum')
    }
  })

  it('requires an absolute anchor date to be written in the clause', () => {
    const { droppedSpecs } = verifyObligations(
      [
        obligation({
          dueSpec: { verbatim: 'by 30 June 2027', offset: null, unit: null, direction: 'on', anchor: 'absolute_date', anchorDate: '30 June 2027' },
        }),
      ],
      CLAUSES,
    )
    expect(droppedSpecs[0].reason).toBe('verbatim_not_in_clause')
  })

  it('accepts an unanchored specification for a clause that states no timing', () => {
    const { obligations, droppedSpecs } = verifyObligations(
      [
        obligation({
          due: 'promptly',
          dueSpec: { verbatim: 'promptly', offset: null, unit: null, direction: null, anchor: 'none', anchorDate: null },
        }),
      ],
      CLAUSES,
    )
    expect(droppedSpecs).toHaveLength(0)
    expect(obligations[0].dueSpec?.anchor).toBe('none')
  })

  it('cannot ground a specification on a clause the document does not contain', () => {
    const { obligations, droppedSpecs } = verifyObligations([obligation({ clauseId: 'nope' })], CLAUSES)
    expect(obligations[0].clauseId).toBeNull()
    expect(droppedSpecs[0].reason).toBe('verbatim_not_in_clause')
  })

  it('keeps an obligation with no specification at all', () => {
    const { obligations, droppedSpecs } = verifyObligations([obligation({ due: null, dueSpec: null })], CLAUSES)
    expect(obligations).toHaveLength(1)
    expect(obligations[0].dueSpec).toBeNull()
    expect(droppedSpecs).toHaveLength(0)
  })

  it('discards a role outside the closed set instead of storing it', () => {
    const { obligations } = verifyObligations([obligation({ partyRole: 'vendor' })], CLAUSES)
    expect(obligations[0].partyRole).toBeNull()
  })

  it('drops an entry with no obligor or no action, which is not an obligation', () => {
    expect(verifyObligations([obligation({ obligor: '  ' })], CLAUSES).obligations).toHaveLength(0)
    expect(verifyObligations([obligation({ action: '' })], CLAUSES).obligations).toHaveLength(0)
  })

  it('keeps the verbatim obligor alongside the role, never replacing it', () => {
    const { obligations } = verifyObligations([obligation({ obligor: 'either party', partyRole: 'both' })], CLAUSES)
    expect(obligations[0].obligor).toBe('either party')
  })
})
