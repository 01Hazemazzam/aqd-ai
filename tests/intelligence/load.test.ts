// tests/intelligence/load.test.ts
//
// These rules used to live inside a server component, where nothing could
// reach them. They are not incidental plumbing: "which analysis is the
// latest" and "which party list wins" decide what the Attention view shows
// AND what the assistant answers, and the whole reason for extracting this
// module is that those two must never diverge. So they get tested.
import { describe, it, expect, vi } from 'vitest'
import { loadIntelligence, type AnalysisRow, type ContractRow, type FindingRow, type IntelligenceReader } from '@/lib/intelligence/load'
import { ANALYSIS_SCHEMA_VERSION } from '@/lib/ai/schema-version'

const TODAY = new Date('2026-09-02T00:00:00Z')

function analysis(over: Partial<AnalysisRow> & Pick<AnalysisRow, 'id' | 'contract_id'>): AnalysisRow {
  return {
    obligations: [],
    obligation_parties: null,
    fields: null,
    schema_version: ANALYSIS_SCHEMA_VERSION,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}

function finding(over: Partial<FindingRow> & Pick<FindingRow, 'id' | 'analysis_id'>): FindingRow {
  return {
    clause_id: 'clause-1',
    kind: 'playbook',
    severity: 'high',
    title: 'Unlimited liability',
    reason: 'Liability is uncapped.',
    reason_ar: 'المسؤولية غير محدودة.',
    rule_key: 'unlimited_liability',
    ...over,
  }
}

/** The in-memory adapter. That this is a literal object is the point of the
    seam -- the shaping rules below need no database to exercise. */
function reader(analyses: AnalysisRow[], contracts: ContractRow[], findings: FindingRow[] = []): IntelligenceReader {
  return {
    readyAnalyses: async () => analyses,
    contracts: async () => contracts,
    findings: async (ids) => findings.filter((f) => ids.includes(f.analysis_id)),
  }
}

describe('loadIntelligence :: which analysis speaks for a contract', () => {
  // Re-analysis supersedes rather than accumulates. If this broke, a contract
  // would contribute its obligations twice and every portfolio count would be
  // inflated -- silently, because both rows are real.
  it('takes the newest analysis per contract and ignores the superseded ones', async () => {
    const bundle = await loadIntelligence(
      reader(
        [
          analysis({ id: 'new', contract_id: 'c1', created_at: '2026-08-30T00:00:00Z', obligations: [{ obligor: 'Provider', action: 'Deliver the report', due: null }] }),
          analysis({ id: 'old', contract_id: 'c1', created_at: '2026-01-01T00:00:00Z', obligations: [{ obligor: 'Provider', action: 'Stale duty', due: null }] }),
        ],
        [{ id: 'c1', title: 'Orion MSA' }],
      ),
      'org-1',
      TODAY,
    )

    expect(bundle.intelligence.obligations).toHaveLength(1)
    expect(bundle.intelligence.obligations[0].action).toBe('Deliver the report')
  })

  it('only asks for the findings of the analyses that actually won', async () => {
    const findings = vi.fn(async () => [])
    await loadIntelligence(
      {
        readyAnalyses: async () => [
          analysis({ id: 'new', contract_id: 'c1', created_at: '2026-08-30T00:00:00Z' }),
          analysis({ id: 'old', contract_id: 'c1', created_at: '2026-01-01T00:00:00Z' }),
        ],
        contracts: async () => [{ id: 'c1', title: 'Orion MSA' }],
        findings,
      },
      'org-1',
      TODAY,
    )

    expect(findings).toHaveBeenCalledWith(['new'])
  })

  it('skips an analysis whose contract is gone, rather than crashing on its title', async () => {
    const bundle = await loadIntelligence(reader([analysis({ id: 'a1', contract_id: 'deleted' })], []), 'org-1', TODAY)
    expect(bundle.intelligence.contracts).toHaveLength(0)
  })

  it('does not go looking for findings when there is nothing to find them for', async () => {
    const findings = vi.fn(async () => [])
    await loadIntelligence({ readyAnalyses: async () => [], contracts: async () => [], findings }, 'org-1', TODAY)
    expect(findings).not.toHaveBeenCalled()
  })
})

describe('loadIntelligence :: whose parties define party_a and party_b', () => {
  // The obligations task names its own parties and assigns roles against
  // THAT list. Preferring the fields task's list would reindex every role in
  // the contract whenever the two disagreed -- and they run concurrently, so
  // they can.
  it('prefers the obligations task’s party list over the fields task’s', async () => {
    const bundle = await loadIntelligence(
      reader(
        [
          analysis({
            id: 'a1',
            contract_id: 'c1',
            obligation_parties: ['Orion Ledger Systems Ltd.', 'Nabta Holdings'],
            fields: { parties: ['Nabta Holdings', 'Orion Ledger Systems Ltd.'] },
          }),
        ],
        [{ id: 'c1', title: 'Orion MSA' }],
      ),
      'org-1',
      TODAY,
    )

    expect(bundle.partyNames['c1']).toEqual(['Orion Ledger Systems Ltd.', 'Nabta Holdings'])
  })

  it('falls back to the fields task for analyses produced before that column existed', async () => {
    const bundle = await loadIntelligence(
      reader([analysis({ id: 'a1', contract_id: 'c1', obligation_parties: null, fields: { parties: ['Alpha', 'Beta'] } })], [{ id: 'c1', title: 'Legacy' }]),
      'org-1',
      TODAY,
    )
    expect(bundle.partyNames['c1']).toEqual(['Alpha', 'Beta'])
  })

  it('treats an empty stored list as absent rather than as "no parties"', async () => {
    const bundle = await loadIntelligence(
      reader([analysis({ id: 'a1', contract_id: 'c1', obligation_parties: [], fields: { parties: ['Alpha', 'Beta'] } })], [{ id: 'c1', title: 'Legacy' }]),
      'org-1',
      TODAY,
    )
    expect(bundle.partyNames['c1']).toEqual(['Alpha', 'Beta'])
  })

  it('survives a contract whose analysis extracted no parties at all', async () => {
    const bundle = await loadIntelligence(reader([analysis({ id: 'a1', contract_id: 'c1' })], [{ id: 'c1', title: 'Bare' }]), 'org-1', TODAY)
    expect(bundle.partyNames['c1']).toEqual([])
  })
})

describe('loadIntelligence :: findings', () => {
  it('attaches each finding to its own contract, carrying both languages', async () => {
    const bundle = await loadIntelligence(
      reader(
        [analysis({ id: 'a1', contract_id: 'c1' }), analysis({ id: 'a2', contract_id: 'c2' })],
        [
          { id: 'c1', title: 'Orion MSA' },
          { id: 'c2', title: 'Nabta NDA' },
        ],
        [finding({ id: 'f1', analysis_id: 'a1' }), finding({ id: 'f2', analysis_id: 'a2', title: 'No termination clause' })],
      ),
      'org-1',
      TODAY,
    )

    const byId = new Map(bundle.findings.map((f) => [f.id, f]))
    expect(byId.get('f1')).toMatchObject({ contractId: 'c1', contractTitle: 'Orion MSA', reason: 'Liability is uncapped.', reasonAr: 'المسؤولية غير محدودة.' })
    expect(byId.get('f2')).toMatchObject({ contractId: 'c2', contractTitle: 'Nabta NDA' })
  })

  // 5 of the 12 findings in the live corpus have no clause: the finding IS
  // that the document lacks the clause. Dropping them here would silently
  // remove 42% of the risk evidence the assistant can cite.
  it('keeps a finding about a clause the document never had', async () => {
    const bundle = await loadIntelligence(
      reader(
        [analysis({ id: 'a1', contract_id: 'c1' })],
        [{ id: 'c1', title: 'Orion MSA' }],
        [finding({ id: 'f1', analysis_id: 'a1', clause_id: null, title: 'No termination clause', rule_key: 'termination_clause' })],
      ),
      'org-1',
      TODAY,
    )

    expect(bundle.findings).toHaveLength(1)
    expect(bundle.findings[0].clauseId).toBeNull()
  })

  it('defaults a finding with no recorded kind to playbook, as the column default does', async () => {
    const bundle = await loadIntelligence(
      reader([analysis({ id: 'a1', contract_id: 'c1' })], [{ id: 'c1', title: 'Orion MSA' }], [finding({ id: 'f1', analysis_id: 'a1', kind: null })]),
      'org-1',
      TODAY,
    )
    expect(bundle.findings[0].kind).toBe('playbook')
  })
})

describe('loadIntelligence :: schema currency', () => {
  it('marks an analysis produced under an older extraction schema as outdated', async () => {
    const bundle = await loadIntelligence(
      reader(
        [analysis({ id: 'a1', contract_id: 'c1', schema_version: 0 }), analysis({ id: 'a2', contract_id: 'c2' })],
        [
          { id: 'c1', title: 'Legacy' },
          { id: 'c2', title: 'Current' },
        ],
      ),
      'org-1',
      TODAY,
    )

    expect(bundle.intelligence.counts.outdated).toBe(1)
    expect(bundle.intelligence.contracts.find((c) => c.contractId === 'c1')?.current).toBe(false)
    expect(bundle.intelligence.contracts.find((c) => c.contractId === 'c2')?.current).toBe(true)
  })
})
