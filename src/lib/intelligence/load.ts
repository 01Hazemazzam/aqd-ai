// The one place the Intelligence layer is read out of the database and
// shaped.
//
// This used to live inline in intelligence/page.tsx, which was fine while the
// page was the only consumer. It stopped being fine the moment the assistant
// had to answer "which contracts need attention?": two independent readers of
// the same tables can disagree about which analysis is the latest, or about
// which party list wins, and then the product has two truths -- the Attention
// view says three contracts, the assistant says four, and both look right in
// isolation. So the fetch-and-shape is a module, and the page and the chat
// route are two callers of it.
//
// The reads sit behind `IntelligenceReader` rather than taking a Supabase
// client directly. That is what makes the latest-per-contract rule, the party
// fallback, and the outdated-schema handling testable at all: the interesting
// logic here is the shaping, and it should not need a database to exercise.
// RLS is unaffected -- the adapter runs the same anon-key client every other
// read in the app uses, so `org_id` scoping still comes from the caller's own
// JWT, not from the `orgId` argument.

import { buildIntelligence, type InputContract, type InputFinding, type InputObligation, type Intelligence } from './build'
import { isCurrentSchema } from '@/lib/ai/schema-version'

export interface AnalysisRow {
  id: string
  contract_id: string
  obligations: unknown
  obligation_parties: unknown
  fields: unknown
  schema_version: number | null
  created_at: string
}

export interface ContractRow {
  id: string
  title: string
}

export interface FindingRow {
  id: string
  analysis_id: string
  clause_id: string | null
  kind: string | null
  severity: 'high' | 'medium' | 'low'
  title: string
  reason: string
  reason_ar: string | null
  rule_key: string | null
}

/** The three reads the Intelligence layer needs. Narrow on purpose: a seam
    this small has an in-memory adapter that is a literal object, which is why
    the shaping rules below have tests. */
export interface IntelligenceReader {
  /** Every ready analysis for the org, newest first. Order is load-bearing --
      the latest-per-contract rule below depends on it. */
  readyAnalyses(orgId: string): Promise<AnalysisRow[]>
  contracts(orgId: string): Promise<ContractRow[]>
  findings(analysisIds: string[]): Promise<FindingRow[]>
}

/** A risk finding with its contract already attached, in both languages.
 *
 * Deliberately carries `reason` AND `reasonAr` rather than one resolved
 * string: this module is not allowed to know the reader's locale, the same
 * rule every other pure module in `src/lib` follows. The caller picks.
 *
 * `clauseId` is null for the finding kind that is *about* an absent clause
 * ("this contract has no termination clause") -- 5 of the 12 findings in the
 * current corpus, so this is the common case, not an edge one. */
export interface LoadedFinding {
  id: string
  contractId: string
  contractTitle: string
  clauseId: string | null
  kind: InputFinding['kind']
  severity: InputFinding['severity']
  title: string
  reason: string
  reasonAr: string | null
  ruleKey: string | null
}

export interface IntelligenceBundle {
  intelligence: Intelligence
  findings: LoadedFinding[]
  /** Contract id -> the parties that contract's analysis named, in the order
      that defines party_a and party_b. */
  partyNames: Record<string, string[]>
}

type StoredObligation = {
  clauseId?: string | null
  obligor: string
  partyRole?: InputObligation['partyRole']
  action: string
  due: string | null
  dueSpec?: InputObligation['dueSpec']
}

export async function loadIntelligence(reader: IntelligenceReader, orgId: string, today: Date): Promise<IntelligenceBundle> {
  const [analyses, contracts] = await Promise.all([reader.readyAnalyses(orgId), reader.contracts(orgId)])

  const titleById = new Map(contracts.map((c) => [c.id, c.title]))

  // A contract can have several analyses (re-analysis, a new version). Rows
  // arrive newest-first, so the first sighting of a contract_id is its
  // latest; later rows are superseded rather than added to. An analysis whose
  // contract has since been deleted is skipped -- it has no title to show and
  // nothing to link to.
  const seen = new Set<string>()
  const latest: Array<{ id: string; contractId: string; row: AnalysisRow }> = []
  for (const a of analyses) {
    if (seen.has(a.contract_id) || !titleById.has(a.contract_id)) continue
    seen.add(a.contract_id)
    latest.push({ id: a.id, contractId: a.contract_id, row: a })
  }

  const findingRows = latest.length ? await reader.findings(latest.map((l) => l.id)) : []

  const findingsByAnalysis = new Map<string, FindingRow[]>()
  for (const f of findingRows) {
    const list = findingsByAnalysis.get(f.analysis_id)
    if (list) list.push(f)
    else findingsByAnalysis.set(f.analysis_id, [f])
  }

  const input: InputContract[] = latest.map(({ id, contractId, row }) => {
    const fields = (row.fields as Record<string, unknown> | null) ?? null
    const storedParties = row.obligation_parties as string[] | null
    const fieldParties = Array.isArray(fields?.parties) ? (fields.parties as string[]) : []
    return {
      contractId,
      title: titleById.get(contractId)!,
      effectiveDate: (fields?.effectiveDate as string | null) ?? null,
      termLength: (fields?.termLength as string | null) ?? null,
      // The obligations task names its own parties, and those are the ones
      // party_a/party_b refer to. The fields task's list is only a display
      // fallback for analyses produced before that column existed -- the two
      // tasks run concurrently and can disagree, and reconciling them by
      // array position would misattribute every obligation in the contract.
      parties: storedParties?.length ? storedParties : fieldParties,
      findings: (findingsByAnalysis.get(id) ?? []).map(
        (f): InputFinding => ({
          id: f.id,
          clauseId: f.clause_id,
          kind: (f.kind as InputFinding['kind'] | null) ?? 'playbook',
          severity: f.severity,
          title: f.title,
        }),
      ),
      obligations: ((row.obligations as StoredObligation[] | null) ?? []).map(
        (o): InputObligation => ({
          clauseId: o.clauseId ?? null,
          obligor: o.obligor,
          partyRole: o.partyRole ?? null,
          action: o.action,
          due: o.due,
          dueSpec: o.dueSpec ?? null,
        }),
      ),
      current: isCurrentSchema(row.schema_version),
    }
  })

  const findings: LoadedFinding[] = latest.flatMap(({ id, contractId }) =>
    (findingsByAnalysis.get(id) ?? []).map(
      (f): LoadedFinding => ({
        id: f.id,
        contractId,
        contractTitle: titleById.get(contractId)!,
        clauseId: f.clause_id,
        kind: (f.kind as InputFinding['kind'] | null) ?? 'playbook',
        severity: f.severity,
        title: f.title,
        reason: f.reason,
        reasonAr: f.reason_ar,
        ruleKey: f.rule_key,
      }),
    ),
  )

  return {
    intelligence: buildIntelligence(input, today),
    findings,
    partyNames: Object.fromEntries(input.map((c) => [c.contractId, c.parties])),
  }
}
