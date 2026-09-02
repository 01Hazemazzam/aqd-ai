// tests/revision/align.test.ts
//
// The alignment is the whole comparison: every number the compare view shows
// and every diff it renders is downstream of which clause got paired with
// which. A wrong pairing does not look like a bug -- it looks like an edit
// the counterparty never made, which is the one thing this feature exists to
// report accurately.
import { describe, it, expect } from 'vitest'
import { compareVersions, type ClauseChange, type RevisionClause } from '@/lib/revision/align'

let seq = 0
const clause = (body: string, clauseNumber: string | null = null, lang: 'ar' | 'en' = 'en'): RevisionClause => ({
  id: `c${++seq}`,
  ordinal: seq,
  clauseNumber,
  lang,
  body,
})

const kinds = (changes: ClauseChange[]) => changes.map((c) => c.kind)

const LIABILITY = 'Each party’s aggregate liability under this Agreement shall not exceed the fees paid in the twelve months preceding the claim.'
const TERM = 'This Agreement commences on the Effective Date and continues for an initial term of twenty-four (24) months.'
const NOTICE = 'Either party may terminate this Agreement for convenience on sixty (60) days written notice to the other party.'

describe('compareVersions :: a document that did not change', () => {
  it('reports every clause unchanged and says so as one fact', () => {
    const base = [clause(TERM, '1'), clause(LIABILITY, '2')]
    const revised = [clause(TERM, '1'), clause(LIABILITY, '2')]

    const result = compareVersions(base, revised)

    expect(kinds(result.changes)).toEqual(['unchanged', 'unchanged'])
    expect(result.identical).toBe(true)
    expect(result.counts).toEqual({ unchanged: 2, modified: 0, added: 0, removed: 0 })
  })

  // A re-typed document differs in ways nobody negotiated: curly quotes from
  // one editor, straight from another; an em dash where there was a hyphen.
  // Reporting those as amendments would bury the one real edit among thirty.
  it('does not call a change of punctuation style an amendment', () => {
    const base = [clause('The Provider shall deliver the Services — as described in Schedule A — with reasonable skill.')]
    const revised = [clause('The Provider shall deliver the Services - as described in Schedule A - with reasonable skill.')]

    expect(compareVersions(base, revised).identical).toBe(true)
  })

  // Whitespace differs whenever a PDF and a DOCX of the same draft are
  // parsed, because the two parsers wrap lines differently.
  it('does not call re-wrapped text an amendment', () => {
    const base = [clause('The  Provider   shall\n\ndeliver the Services.')]
    const revised = [clause('The Provider shall deliver the Services.')]

    expect(compareVersions(base, revised).identical).toBe(true)
  })
})

describe('compareVersions :: the three kinds of change', () => {
  it('reports an edited clause as modified, carrying both texts', () => {
    const base = [clause(LIABILITY, '7')]
    const revised = [clause(LIABILITY.replace('twelve months', 'three months'), '7')]

    const [change] = compareVersions(base, revised).changes

    expect(change.kind).toBe('modified')
    if (change.kind !== 'modified') throw new Error('unreachable')
    expect(change.base.body).toContain('twelve months')
    expect(change.revised.body).toContain('three months')
  })

  it('reports a clause the revision adds', () => {
    const base = [clause(TERM, '1')]
    const revised = [clause(TERM, '1'), clause(NOTICE, '2')]

    const result = compareVersions(base, revised)

    expect(kinds(result.changes)).toEqual(['unchanged', 'added'])
    expect(result.counts.added).toBe(1)
  })

  it('reports a clause the revision deletes', () => {
    const base = [clause(TERM, '1'), clause(NOTICE, '2')]
    const revised = [clause(TERM, '1')]

    const result = compareVersions(base, revised)

    expect(kinds(result.changes)).toEqual(['unchanged', 'removed'])
    expect(result.counts.removed).toBe(1)
  })

  // A deletion has no position in the revised document, and the reader is
  // scanning that document. Putting it after the clause it used to follow is
  // the only placement where they will come across it while reading.
  it('places a deleted clause after the surviving clause it followed', () => {
    const base = [clause(TERM, '1'), clause(NOTICE, '2'), clause(LIABILITY, '3')]
    const revised = [clause(TERM, '1'), clause(LIABILITY, '3')]

    const result = compareVersions(base, revised)

    expect(kinds(result.changes)).toEqual(['unchanged', 'removed', 'unchanged'])
  })

  it('places a deletion from the top of the document at the top', () => {
    const base = [clause(NOTICE, '1'), clause(TERM, '2')]
    const revised = [clause(TERM, '2')]

    expect(kinds(compareVersions(base, revised).changes)).toEqual(['removed', 'unchanged'])
  })
})

describe('compareVersions :: what the counterparty does to the numbering', () => {
  // Deleting clause 4 renumbers 5 through 30. Matching on position or number
  // alone would report twenty-six amendments; matching on text reports one
  // deletion, which is what happened.
  it('follows a clause through renumbering', () => {
    const base = [clause(TERM, '4'), clause(NOTICE, '5'), clause(LIABILITY, '6')]
    const revised = [clause(NOTICE, '4'), clause(LIABILITY, '5')]

    const result = compareVersions(base, revised)

    expect(kinds(result.changes)).toEqual(['removed', 'unchanged', 'unchanged'])
  })

  // The reverse case: the number is the only thing holding still while the
  // text is rewritten past recognition.
  it('pairs a rewritten clause to the number it kept', () => {
    const base = [clause('The Provider warrants the Services will conform to the Documentation.', '9')]
    const revised = [clause('The Services are provided on an as-is basis with no warranty of any kind.', '9')]

    const [change] = compareVersions(base, revised).changes

    expect(change.kind).toBe('modified')
  })

  // A number that identifies two different clauses identifies neither.
  // Schedules that restart at 1 are the common source.
  it('gives a repeated clause number no weight at all', () => {
    const base = [clause('Payment is due within thirty days of invoice.', '1'), clause('Notices are delivered by courier.', '1')]
    const revised = [clause('The parties shall meet quarterly to review performance.', '1'), clause('Each party bears its own costs.', '1')]

    const result = compareVersions(base, revised)

    expect(result.counts.modified).toBe(0)
    expect(result.counts.added).toBe(2)
    expect(result.counts.removed).toBe(2)
  })

  it('reads an Arabic-Indic clause number as the number it is', () => {
    const base = [clause('يلتزم المزود بتقديم الخدمات وفقاً للجدول ألف.', '٣', 'ar')]
    const revised = [clause('يلتزم المزود بتقديم الدعم الفني على مدار الساعة.', '3', 'ar')]

    expect(compareVersions(base, revised).changes[0].kind).toBe('modified')
  })
})

describe('compareVersions :: Arabic text', () => {
  // Harakat and tatweel are typographic, not semantic. The same clause is
  // routinely typed with them in one draft and without in the next.
  it('does not call vowel marks or elongation an amendment', () => {
    const base = [clause('يلتزِمُ الطرفان بالسِرّية التامة.', null, 'ar')]
    const revised = [clause('يلتزم الطرفان بـالسرية التامة.', null, 'ar')]

    expect(compareVersions(base, revised).identical).toBe(true)
  })

  it('pairs an edited Arabic clause on its word overlap', () => {
    const base = [
      clause('يجوز لأي من الطرفين إنهاء هذا الاتفاق بإشعار خطي مدته ستون يوماً إلى الطرف الآخر.', null, 'ar'),
    ]
    const revised = [
      clause('يجوز لأي من الطرفين إنهاء هذا الاتفاق بإشعار خطي مدته تسعون يوماً إلى الطرف الآخر.', null, 'ar'),
    ]

    const [change] = compareVersions(base, revised).changes

    expect(change.kind).toBe('modified')
  })
})

describe('compareVersions :: when not to claim a pairing', () => {
  // Two clauses that share nothing but legal boilerplate are two clauses. A
  // false pairing hides a deletion behind an "edit" nobody made; the honest
  // failure is to report both halves and let the reader see them.
  it('leaves genuinely unrelated clauses unpaired', () => {
    const base = [clause('The Provider shall maintain professional indemnity insurance of not less than KWD 250,000.')]
    const revised = [clause('Neither party may assign this Agreement without the prior written consent of the other.')]

    const result = compareVersions(base, revised)

    expect(kinds(result.changes)).toEqual(['removed', 'added'])
    expect(result.counts.modified).toBe(0)
  })

  it('pairs the better candidate when two clauses compete for one partner', () => {
    const base = [clause(LIABILITY, '5')]
    const revised = [
      clause(LIABILITY.replace('twelve months', 'six months'), '5'),
      clause('Each party liability for data protection breaches is unlimited.', '6'),
    ]

    const result = compareVersions(base, revised)

    expect(kinds(result.changes)).toEqual(['modified', 'added'])
  })
})

describe('compareVersions :: the invariants the view depends on', () => {
  it('accounts for every clause on both sides exactly once', () => {
    const base = [clause(TERM, '1'), clause(NOTICE, '2'), clause(LIABILITY, '3'), clause('Costs lie where they fall.', '4')]
    const revised = [
      clause(TERM, '1'),
      clause(LIABILITY.replace('twelve', 'six'), '2'),
      clause('The Provider shall appoint a named account manager.', '3'),
    ]

    const { changes } = compareVersions(base, revised)
    const baseSeen = changes.flatMap((c) => ('base' in c ? [c.base.id] : []))
    const revisedSeen = changes.flatMap((c) => ('revised' in c ? [c.revised.id] : []))

    expect(new Set(baseSeen).size).toBe(baseSeen.length)
    expect(new Set(revisedSeen).size).toBe(revisedSeen.length)
    expect(baseSeen.sort()).toEqual(base.map((c) => c.id).sort())
    expect(revisedSeen.sort()).toEqual(revised.map((c) => c.id).sort())
  })

  // The first upload has nothing to compare against, and the view is reached
  // by URL as readily as by link.
  it('treats a comparison against nothing as an all-new document', () => {
    const revised = [clause(TERM, '1'), clause(NOTICE, '2')]

    const result = compareVersions([], revised)

    expect(kinds(result.changes)).toEqual(['added', 'added'])
    expect(result.identical).toBe(false)
  })

  it('reports two empty versions as identical rather than as nothing', () => {
    const result = compareVersions([], [])

    expect(result.changes).toEqual([])
    expect(result.identical).toBe(true)
  })
})
