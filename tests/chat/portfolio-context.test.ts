// tests/chat/portfolio-context.test.ts
//
// The assembler decides two things at once: what the model is allowed to see,
// and what every [n] in its answer means. Those two have to agree exactly --
// an off-by-one here renders a citation as a link to the wrong contract, and
// nothing downstream can detect it. So the numbering and the resolution are
// tested against each other, not separately.
//
// Fixtures are built through loadIntelligence with an in-memory reader rather
// than by hand-constructing an Intelligence object, so these tests exercise
// the real path from database rows to prompt text.
import { describe, it, expect } from 'vitest'
import { assemblePortfolioContext, resolvePortfolioCitations } from '@/lib/chat/portfolio-context'
import { loadIntelligence, type AnalysisRow, type ContractRow, type FindingRow, type IntelligenceReader } from '@/lib/intelligence/load'
import { ANALYSIS_SCHEMA_VERSION } from '@/lib/ai/schema-version'

const TODAY = new Date('2026-09-02T00:00:00Z')

// The hard QA fixture's own facts: effective 1 September 2026, initial term
// 21 months, which the document itself says ends 31 May 2028.
const FIELDS = { effectiveDate: '1 September 2026', termLength: 'twenty-one (21) months', parties: ['Orion Ledger Systems Ltd.', 'Nabta Holdings'] }

const RENEWAL_NOTICE = {
  clauseId: 'clause-renewal',
  obligor: 'Either party',
  partyRole: 'both' as const,
  action: 'Give notice of non-renewal',
  due: 'at least sixty (60) days before the end of the then-current term',
  dueSpec: {
    verbatim: 'at least sixty (60) days before the end of the then-current term',
    offset: 60,
    unit: 'day' as const,
    direction: 'before' as const,
    anchor: 'term_end' as const,
    anchorDate: null,
  },
}

const AFTER_RECEIPT = {
  clauseId: 'clause-audit',
  obligor: 'Orion Ledger Systems Ltd.',
  partyRole: 'party_a' as const,
  action: 'Provide the audit records',
  due: 'within thirty (30) days after receipt of a written request',
  dueSpec: {
    verbatim: 'within thirty (30) days after receipt of a written request',
    offset: 30,
    unit: 'day' as const,
    direction: 'after' as const,
    anchor: 'contract_event' as const,
    anchorDate: null,
  },
}

function reader(analyses: AnalysisRow[], contracts: ContractRow[], findings: FindingRow[] = []): IntelligenceReader {
  return {
    readyAnalyses: async () => analyses,
    contracts: async () => contracts,
    findings: async (ids) => findings.filter((f) => ids.includes(f.analysis_id)),
  }
}

function analysis(over: Partial<AnalysisRow> & Pick<AnalysisRow, 'id' | 'contract_id'>): AnalysisRow {
  return {
    obligations: [],
    obligation_parties: FIELDS.parties,
    fields: { effectiveDate: FIELDS.effectiveDate, termLength: FIELDS.termLength },
    schema_version: ANALYSIS_SCHEMA_VERSION,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}

async function context(analyses: AnalysisRow[], contracts: ContractRow[], findings: FindingRow[] = []) {
  const bundle = await loadIntelligence(reader(analyses, contracts, findings), 'org-1', TODAY)
  return assemblePortfolioContext(bundle)
}

const ORION: ContractRow = { id: 'c1', title: 'Orion MSA' }

describe('assemblePortfolioContext :: citation targets', () => {
  it('points a clause-anchored finding at its clause, so the reader lands on the words', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1' })],
      [ORION],
      [
        {
          id: 'f1',
          analysis_id: 'a1',
          clause_id: 'clause-liability',
          kind: 'playbook',
          severity: 'high',
          title: 'Unlimited liability',
          reason: 'Liability is uncapped.',
          reason_ar: null,
          rule_key: 'unlimited_liability',
        },
      ],
    )

    expect(ctx.sources).toEqual([{ ordinal: 1, contractId: 'c1', target: { kind: 'clause', clauseId: 'clause-liability' } }])
  })

  // The reason the finding citation target exists at all. 5 of the 12
  // findings in the live corpus are of this kind; without a target they
  // could not be stated, and "this contract has no termination clause" is
  // one of the more valuable things the assistant can say.
  it('points a finding about an ABSENT clause at the finding itself', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1' })],
      [ORION],
      [
        {
          id: 'f1',
          analysis_id: 'a1',
          clause_id: null,
          kind: 'playbook',
          severity: 'high',
          title: 'No termination clause',
          reason: 'The contract never says how either party may terminate.',
          reason_ar: null,
          rule_key: 'termination_clause',
        },
      ],
    )

    expect(ctx.sources[0].target).toEqual({ kind: 'finding', findingId: 'f1' })
    expect(ctx.text).toContain('does NOT contain')
  })

  it('numbers findings and obligations in one continuous sequence', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE, AFTER_RECEIPT] })],
      [ORION],
      [
        { id: 'f1', analysis_id: 'a1', clause_id: 'clause-liability', kind: 'playbook', severity: 'high', title: 'Unlimited liability', reason: 'Uncapped.', reason_ar: null, rule_key: null },
      ],
    )

    expect(ctx.sources.map((s) => s.ordinal)).toEqual([1, 2, 3])
    expect(ctx.text).toContain('[1] RISK')
    expect(ctx.text).toContain('[2] OBLIGATION')
    expect(ctx.text).toContain('[3] OBLIGATION')
  })
})

describe('resolvePortfolioCitations', () => {
  it('resolves every ordinal the model actually used', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] })],
      [ORION],
      [{ id: 'f1', analysis_id: 'a1', clause_id: null, kind: 'playbook', severity: 'high', title: 'No termination clause', reason: 'Absent.', reason_ar: null, rule_key: null }],
    )

    expect(resolvePortfolioCitations('Two things matter [1] and [2].', ctx.sources)).toEqual([
      { ordinal: 1, contractId: 'c1', clauseId: null, findingId: 'f1' },
      { ordinal: 2, contractId: 'c1', clauseId: 'clause-renewal', findingId: null },
    ])
  })

  // A hallucinated ordinal must resolve to nothing, never to whatever record
  // happens to sit at that index -- that is the difference between a dropped
  // citation and a confidently wrong link.
  it('drops an ordinal the model was never shown', async () => {
    const ctx = await context([analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] })], [ORION])
    expect(resolvePortfolioCitations('See [1] and [9].', ctx.sources)).toHaveLength(1)
  })

  it('never returns a citation with both targets set, matching the database check', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] })],
      [ORION],
      [{ id: 'f1', analysis_id: 'a1', clause_id: null, kind: 'playbook', severity: 'low', title: 'x', reason: 'y', reason_ar: null, rule_key: null }],
    )
    for (const c of resolvePortfolioCitations('[1] [2]', ctx.sources)) {
      expect([c.clauseId, c.findingId].filter((v) => v !== null)).toHaveLength(1)
    }
  })
})

describe('assemblePortfolioContext :: keeping computed dates distinguishable', () => {
  it('marks a resolved deadline COMPUTED and shows the arithmetic beside it', async () => {
    const ctx = await context([analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] })], [ORION])
    // 2028-05-31 minus 60 days. The model is never asked to do this sum -- it
    // is handed the answer and the working.
    expect(ctx.text).toContain('COMPUTED 2028-04-01 (initial term end 2028-05-31, minus 60 days)')
  })

  it('marks the initial term end COMPUTED, using the document’s own term wording', async () => {
    const ctx = await context([analysis({ id: 'a1', contract_id: 'c1' })], [ORION])
    expect(ctx.text).toContain('initial term ends: COMPUTED 2028-05-31 (effective date 2026-09-01 plus twenty-one (21) months)')
  })

  it('gives the reason an event-anchored deadline has no date, instead of omitting it', async () => {
    const ctx = await context([analysis({ id: 'a1', contract_id: 'c1', obligations: [AFTER_RECEIPT] })], [ORION])
    expect(ctx.text).toContain('no date derivable -- counts from an event the contract never dates')
    // The document's own wording still travels, so the assistant can answer
    // "when?" with what the contract actually says.
    expect(ctx.text).toContain('timing as written: "within thirty (30) days after receipt of a written request"')
  })
})

describe('assemblePortfolioContext :: coverage', () => {
  it('names the contracts whose analysis never extracted deadlines', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1', schema_version: 0 }), analysis({ id: 'a2', contract_id: 'c2' })],
      [ORION, { id: 'c2', title: 'Nabta NDA' }],
    )

    expect(ctx.incomplete).toEqual(['Orion MSA'])
    expect(ctx.text).toContain("this contract's analysis predates deadline extraction")
  })

  it('reports no incomplete contracts when every analysis is current', async () => {
    const ctx = await context([analysis({ id: 'a1', contract_id: 'c1' })], [ORION])
    expect(ctx.incomplete).toEqual([])
  })
})

describe('assemblePortfolioContext :: the narrowing seam', () => {
  // Q4's seam. Today it is the identity function because the whole portfolio
  // is ~1% of the model's context; this test is what stops it rotting before
  // the corpus outgrows that.
  it('assembles only what the narrowing function passes through', async () => {
    const bundle = await loadIntelligence(
      reader(
        [analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] }), analysis({ id: 'a2', contract_id: 'c2', obligations: [AFTER_RECEIPT] })],
        [ORION, { id: 'c2', title: 'Nabta NDA' }],
      ),
      'org-1',
      TODAY,
    )

    const onlyOrion = assemblePortfolioContext(bundle, (b) => ({
      ...b,
      intelligence: {
        ...b.intelligence,
        contracts: b.intelligence.contracts.filter((c) => c.contractId === 'c1'),
        obligations: b.intelligence.obligations.filter((o) => o.contractId === 'c1'),
      },
    }))

    expect(onlyOrion.text).toContain('Orion MSA')
    expect(onlyOrion.text).not.toContain('Nabta NDA')
    expect(onlyOrion.sources.every((s) => s.contractId === 'c1')).toBe(true)
  })
})

describe('assemblePortfolioContext :: defects a live run exposed', () => {
  // The first live portfolio answer read:
  //   "Aqd_AI_Contract_Stress_Test_04 [contract=c9704933-70d7-...]"
  // -- a raw UUID in prose shown to a user. Same failure renderClausesPlain
  // already documents for clause ids: the fix is not a "don't mention the id"
  // rule, it is not putting an identifier in front of the model that it has
  // nowhere to put.
  it('never puts a raw identifier in front of the model', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] })],
      [ORION],
      [{ id: 'f1', analysis_id: 'a1', clause_id: 'clause-renewal', kind: 'playbook', severity: 'high', title: 'Auto-renewal', reason: 'Renews silently.', reason_ar: null, rule_key: null }],
    )

    expect(ctx.text).not.toContain('contract=')
    expect(ctx.text).not.toContain('c1')
    expect(ctx.text).not.toContain('clause-renewal')
    expect(ctx.text).not.toContain('f1')
    // The contract is identifiable the way a reader identifies it.
    expect(ctx.text).toContain('CONTRACT "Orion MSA"')
  })

  // The same live answer named three contracts as needing attention and cited
  // NOTHING. The evidence existed, but every finding sat in one distant block
  // and every obligation in another, with nothing tying either to the contract
  // the claim was about.
  it('renders each contract’s evidence underneath that contract', async () => {
    const ctx = await context(
      [
        analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] }),
        analysis({ id: 'a2', contract_id: 'c2', obligations: [AFTER_RECEIPT] }),
      ],
      [ORION, { id: 'c2', title: 'Nabta NDA' }],
    )

    // Contracts are ordered by attention tier, not by insertion, so the test
    // asks the question that actually matters: does each obligation fall
    // inside its OWN contract's block?
    const blocks = ctx.text.split(/(?=CONTRACT ")/)
    const orion = blocks.find((b) => b.startsWith('CONTRACT "Orion MSA"'))!
    const nabta = blocks.find((b) => b.startsWith('CONTRACT "Nabta NDA"'))!

    expect(orion).toContain('Give notice of non-renewal')
    expect(orion).not.toContain('Provide the audit records')
    expect(nabta).toContain('Provide the audit records')
    expect(nabta).not.toContain('Give notice of non-renewal')
  })

  // "Which contracts need attention?" is the question this whole scope exists
  // for, so the thing that makes a contract need attention has to be citable.
  it('numbers attention items so a "needs attention" claim has something to cite', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] })],
      [ORION],
      // A finding on the SAME clause as the obligation is what makes an
      // attention item exist at all.
      [{ id: 'f1', analysis_id: 'a1', clause_id: 'clause-renewal', kind: 'playbook', severity: 'high', title: 'Auto-renewal without notice', reason: 'Renews silently.', reason_ar: null, rule_key: 'auto_renewal_notice' }],
    )

    expect(ctx.text).toContain('ATTENTION ITEMS')
    expect(ctx.text).toContain('high risk on a clause that also carries a duty')

    // Every ordinal shown in the text resolves to a real source -- the
    // property the whole citation contract rests on.
    const shown = [...ctx.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
    expect(shown.length).toBeGreaterThan(0)
    expect(resolvePortfolioCitations(shown.map((n) => `[${n}]`).join(' '), ctx.sources)).toHaveLength(shown.length)
  })
})

describe('assemblePortfolioContext :: no internal labels reach the model', () => {
  // A live answer said a contract "is in the due_soon attention tier". An
  // enum name in user-facing prose is the same defect as a leaked UUID -- it
  // just reads as English, so it hides better. The model can only write what
  // it is shown.
  it('describes the attention tier in words, never by its enum name', async () => {
    const ctx = await context([analysis({ id: 'a1', contract_id: 'c1' })], [ORION])

    for (const tier of ['overdue_high_risk', 'due_soon_high_risk', 'high_risk_undated', 'due_soon', 'monitored']) {
      expect(ctx.text).not.toContain(tier)
    }
    expect(ctx.text).toContain('why it ranks where it does:')
  })

  // Square brackets mean "citation" everywhere else in this product, so an
  // urgency label wrapped in them is both an enum leak and a fake citation.
  it('never wraps a non-citation label in square brackets', async () => {
    const ctx = await context(
      [analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] })],
      [ORION],
      [{ id: 'f1', analysis_id: 'a1', clause_id: 'clause-renewal', kind: 'playbook', severity: 'medium', title: 'Auto-renewal', reason: 'Renews silently.', reason_ar: null, rule_key: null }],
    )

    for (const bracketed of ctx.text.match(/\[[^\]]*\]/g) ?? []) {
      expect(bracketed).toMatch(/^\[\d+\]$/)
    }
  })
})

describe('QA follow-up :: where a computed deadline comes from', () => {
  // QA asked for it to be immediately obvious which clause supplies the
  // interval and which supplies the anchor -- they have different provenance,
  // and only one of them is citable.
  it('says which half of a computed deadline is stated and which is itself computed', async () => {
    const ctx = await context([analysis({ id: 'a1', contract_id: 'c1', obligations: [RENEWAL_NOTICE] })], [ORION])

    expect(ctx.text).toContain("the interval is stated in THIS record's clause")
    expect(ctx.text).toContain('itself computed from the contract')
    // And the arithmetic is still shown in full.
    expect(ctx.text).toContain('COMPUTED 2028-04-01 (initial term end 2028-05-31, minus 60 days)')
  })
})
