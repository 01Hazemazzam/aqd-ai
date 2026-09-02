// Builds the contract intelligence layer: the milestone calendar, the
// obligations register, the attention items where risk and duty coincide, and
// the per-contract ranking over all of it.
//
// One entry point rather than four, because all four are the same walk over
// the same data and splitting them would mean walking it four times and
// keeping four notions of "urgent" in sync. Callers get whichever slice they
// render.
//
// Everything here is arithmetic over facts the contracts state -- no date,
// role, or risk relationship appears without something in the document behind
// it. `today` is injected so the whole module is deterministic and testable
// through this one interface.

import { initialTermEnd, parseStatedDate } from './dates'
import { resolveDue, type ContractFacts, type DueSpec, type Resolution } from './due-spec'
import { normalizeObligor, type PartyRole } from './party-role'

export type Severity = 'high' | 'medium' | 'low'
export type FindingKind = 'playbook' | 'asymmetry' | 'contradiction' | 'dependency'

/** How close a dated thing is. Mirrors the obligations register's vocabulary
    so "due soon" means the same thing everywhere in the product. */
export type Urgency = 'overdue' | 'soon' | 'upcoming'

const SOON_DAYS = 30

export interface InputFinding {
  id: string
  clauseId: string | null
  kind: FindingKind
  severity: Severity
  title: string
}

export interface InputObligation {
  clauseId: string | null
  obligor: string
  action: string
  /** The document's own words for when, kept verbatim. */
  due: string | null
  /** Extracted structure; absent on analyses predating the schema change. */
  dueSpec?: DueSpec | null
  /** Extractor-supplied role; falls back to normalizeObligor when absent. */
  partyRole?: PartyRole | null
}

export interface InputContract {
  contractId: string
  title: string
  effectiveDate: string | null
  termLength: string | null
  parties: string[]
  findings: InputFinding[]
  obligations: InputObligation[]
  /** False when this contract's analysis predates the current extraction
      schema, so the UI can say why its deadlines are missing. */
  current: boolean
}

export type MilestoneKind = 'effective_date' | 'term_end' | 'obligation'

export interface Milestone {
  contractId: string
  contractTitle: string
  kind: MilestoneKind
  /** ISO yyyy-mm-dd. Only resolved milestones appear. */
  date: string
  urgency: Urgency
  label: string
  /** Why this date exists, in words. Empty for lifecycle dates the contract
      states outright. */
  derivation: string
  clauseId: string | null
}

export interface TrackedObligation extends InputObligation {
  contractId: string
  contractTitle: string
  role: PartyRole | null
  resolution: Resolution
}

/** A clause carrying BOTH a risk finding and an obligation -- a duty someone
    must perform that the analysis also flagged. The primitive of this layer:
    it is what makes an item actionable rather than merely listed. */
export interface AttentionItem {
  contractId: string
  contractTitle: string
  clauseId: string
  severity: Severity
  kind: FindingKind
  findingTitle: string
  obligor: string
  role: PartyRole | null
  action: string
  due: string | null
  resolution: Resolution
  /** Present only when the obligation's deadline resolved. */
  urgency: Urgency | null
}

/** Explicit tiers, not a blended score, so the ordering can be explained.
    Ordered worst first. */
export type AttentionTier =
  | 'overdue_high_risk'
  | 'due_soon_high_risk'
  | 'overdue'
  | 'due_soon'
  | 'high_risk_undated'
  | 'monitored'

export const TIER_ORDER: readonly AttentionTier[] = [
  'overdue_high_risk',
  'due_soon_high_risk',
  'overdue',
  'due_soon',
  'high_risk_undated',
  'monitored',
]

export interface ContractAttention {
  contractId: string
  title: string
  tier: AttentionTier
  current: boolean
  highRiskCount: number
  attentionCount: number
  /** The soonest resolved milestone for this contract, if any. */
  nextDate: string | null
  nextLabel: string | null
}

export interface Intelligence {
  milestones: Milestone[]
  obligations: TrackedObligation[]
  attention: AttentionItem[]
  contracts: ContractAttention[]
  counts: {
    contracts: number
    outdated: number
    resolvedDeadlines: number
    unresolvedDeadlines: number
    overdue: number
    soon: number
    attention: number
  }
}

function urgencyFor(date: string, today: string): Urgency {
  const a = Date.parse(`${date}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  const days = Math.floor((a - b) / 86_400_000)
  if (days < 0) return 'overdue'
  return days <= SOON_DAYS ? 'soon' : 'upcoming'
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 }

// Only a duty can be overdue. A contract's effective date passing means the
// contract started, and its initial term end passing means it is in a renewal
// period -- neither is a missed action, and ranking a contract as urgent
// because it began eighteen months ago would make the whole view noise. Soon
// is different: an approaching term end is a real renewal decision, so every
// milestone counts toward it.
function isMissable(m: Milestone): boolean {
  return m.kind === 'obligation'
}

function tierFor(items: AttentionItem[], milestones: Milestone[], highRiskCount: number): AttentionTier {
  const highs = items.filter((i) => i.severity === 'high')
  if (highs.some((i) => i.urgency === 'overdue')) return 'overdue_high_risk'
  if (highs.some((i) => i.urgency === 'soon')) return 'due_soon_high_risk'
  if (milestones.some((m) => isMissable(m) && m.urgency === 'overdue')) return 'overdue'
  if (milestones.some((m) => m.urgency === 'soon')) return 'due_soon'
  // A high-severity risk on a duty nobody can put a date to is still the most
  // useful thing to show next -- it is exposure with no scheduled prompt.
  if (highs.length > 0 || highRiskCount > 0) return 'high_risk_undated'
  return 'monitored'
}

export function buildIntelligence(contracts: InputContract[], today: Date): Intelligence {
  const todayIso = today.toISOString().slice(0, 10)

  const milestones: Milestone[] = []
  const obligations: TrackedObligation[] = []
  const attention: AttentionItem[] = []
  const contractRows: ContractAttention[] = []

  for (const c of contracts) {
    const facts: ContractFacts = { effectiveDate: c.effectiveDate, termLength: c.termLength }
    const contractMilestones: Milestone[] = []

    // Lifecycle milestones. The effective date is stated outright; the term
    // end is arithmetic over two stated facts (see ADR-0003) and carries its
    // derivation so the calendar never shows an unexplainable date.
    const effective = parseStatedDate(c.effectiveDate)
    if (effective) {
      contractMilestones.push({
        contractId: c.contractId,
        contractTitle: c.title,
        kind: 'effective_date',
        date: effective,
        urgency: urgencyFor(effective, todayIso),
        label: c.title,
        derivation: '',
        clauseId: null,
      })
    }

    const termEnd = initialTermEnd(c.effectiveDate, c.termLength)
    if (termEnd) {
      contractMilestones.push({
        contractId: c.contractId,
        contractTitle: c.title,
        kind: 'term_end',
        date: termEnd,
        urgency: urgencyFor(termEnd, todayIso),
        label: c.title,
        derivation: `${effective} plus ${c.termLength}`,
        clauseId: null,
      })
    }

    // Every finding on a clause, worst-first, so an attention item pairs an
    // obligation with the most serious thing flagged on the same clause.
    const worstByClause = new Map<string, InputFinding>()
    for (const f of c.findings) {
      if (!f.clauseId) continue
      const current = worstByClause.get(f.clauseId)
      if (!current || SEVERITY_RANK[f.severity] > SEVERITY_RANK[current.severity]) worstByClause.set(f.clauseId, f)
    }
    const highRiskCount = c.findings.filter((f) => f.severity === 'high').length

    for (const o of c.obligations) {
      const resolution = resolveDue(o.dueSpec, facts)
      const role = o.partyRole ?? normalizeObligor(o.obligor, c.parties)
      const tracked: TrackedObligation = { ...o, contractId: c.contractId, contractTitle: c.title, role, resolution }
      obligations.push(tracked)

      const urgency = resolution.date ? urgencyFor(resolution.date, todayIso) : null

      if (resolution.date) {
        contractMilestones.push({
          contractId: c.contractId,
          contractTitle: c.title,
          kind: 'obligation',
          date: resolution.date,
          urgency: urgency!,
          label: o.action,
          derivation: resolution.derivation ?? '',
          clauseId: o.clauseId,
        })
      }

      const finding = o.clauseId ? worstByClause.get(o.clauseId) : undefined
      if (finding) {
        attention.push({
          contractId: c.contractId,
          contractTitle: c.title,
          clauseId: o.clauseId!,
          severity: finding.severity,
          kind: finding.kind,
          findingTitle: finding.title,
          obligor: o.obligor,
          role,
          action: o.action,
          due: o.due,
          resolution,
          urgency,
        })
      }
    }

    milestones.push(...contractMilestones)

    const contractAttention = attention.filter((a) => a.contractId === c.contractId)
    // "Next" is the soonest milestone not already behind us -- an overdue one
    // is surfaced by the tier, not by being called next.
    const next =
      [...contractMilestones].sort((a, b) => a.date.localeCompare(b.date)).find((m) => m.date >= todayIso) ?? null

    contractRows.push({
      contractId: c.contractId,
      title: c.title,
      tier: tierFor(contractAttention, contractMilestones, highRiskCount),
      current: c.current,
      highRiskCount,
      attentionCount: contractAttention.length,
      nextDate: next?.date ?? null,
      nextLabel: next?.label ?? null,
    })
  }

  milestones.sort((a, b) => a.date.localeCompare(b.date))

  // Worst first, then soonest: a high-severity overdue duty outranks a
  // high-severity one due next month.
  const URGENCY_RANK: Record<Urgency, number> = { overdue: 3, soon: 2, upcoming: 1 }
  attention.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (sev !== 0) return sev
    const ua = a.urgency ? URGENCY_RANK[a.urgency] : 0
    const ub = b.urgency ? URGENCY_RANK[b.urgency] : 0
    if (ua !== ub) return ub - ua
    return a.contractTitle.localeCompare(b.contractTitle)
  })

  contractRows.sort((a, b) => {
    const tier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
    if (tier !== 0) return tier
    if (a.highRiskCount !== b.highRiskCount) return b.highRiskCount - a.highRiskCount
    return a.title.localeCompare(b.title)
  })

  return {
    milestones,
    obligations,
    attention,
    contracts: contractRows,
    counts: {
      contracts: contracts.length,
      outdated: contracts.filter((c) => !c.current).length,
      resolvedDeadlines: obligations.filter((o) => o.resolution.status === 'resolved').length,
      unresolvedDeadlines: obligations.filter((o) => o.resolution.status === 'unresolved').length,
      overdue: milestones.filter((m) => isMissable(m) && m.urgency === 'overdue').length,
      soon: milestones.filter((m) => m.urgency === 'soon').length,
      attention: attention.length,
    },
  }
}
