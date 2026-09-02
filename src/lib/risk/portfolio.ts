// Builds a cross-contract risk portfolio out of the flat risk findings the
// analysis pipeline stores. Each finding already carries its contract identity
// and (optionally) the clause it points at; this helper does the aggregation
// the dashboard needs -- portfolio-level counts, a per-severity breakdown, and
// a per-contract grouping ranked worst-first -- so counting and ranking live in
// one unit-tested place instead of scattered across the page and view.
//
// Pure and deterministic: a function of `rows` alone, no clock, no I/O. The
// caller resolves each finding's locale (English `reason` vs Arabic `reasonAr`)
// before handing rows in, so this module stays language-agnostic and testable
// through its one interface.

export type Severity = 'high' | 'medium' | 'low'

// One finding, flattened with the contract identity and clause number the
// dashboard renders and drills into. `clauseId` is null for a finding about a
// clause the document is MISSING (e.g. "no termination clause"): there is no
// clause to anchor to, so it drills to the contract, not a clause.
export interface RawFinding {
  id: string
  contractId: string
  contractTitle: string
  clauseId: string | null
  clauseNumber: string | null
  severity: Severity
  title: string
  reason: string
  ruleKey: string | null
}

export interface SeverityBreakdown {
  high: number
  medium: number
  low: number
}

// One contract's slice of the portfolio: its findings plus the counts and the
// worst severity present, which drive both the sort order and the stripe color.
export interface PortfolioContract {
  contractId: string
  contractTitle: string
  counts: SeverityBreakdown
  total: number
  topSeverity: Severity
  findings: RawFinding[]
}

export interface RiskPortfolio {
  /** Every finding across all analyzed contracts. */
  total: number
  /** Portfolio-level totals per severity. */
  counts: SeverityBreakdown
  /** How many distinct contracts have at least one finding. */
  contractsAffected: number
  /** Contracts with findings, ranked worst-first. */
  contracts: PortfolioContract[]
  /** All findings, ranked worst-first -- the flat list the severity filter narrows. */
  findings: RawFinding[]
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 }

// Worst-first, then alphabetical by title so equal-severity findings have a
// stable, predictable order rather than depending on fetch order.
function byRiskThenTitle(a: RawFinding, b: RawFinding): number {
  const rank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  return rank !== 0 ? rank : a.title.localeCompare(b.title)
}

export function buildRiskPortfolio(rows: RawFinding[]): RiskPortfolio {
  const counts: SeverityBreakdown = { high: 0, medium: 0, low: 0 }
  const byContract = new Map<string, PortfolioContract>()

  for (const row of rows) {
    counts[row.severity] += 1

    let contract = byContract.get(row.contractId)
    if (!contract) {
      contract = {
        contractId: row.contractId,
        contractTitle: row.contractTitle,
        counts: { high: 0, medium: 0, low: 0 },
        total: 0,
        topSeverity: row.severity,
        findings: [],
      }
      byContract.set(row.contractId, contract)
    }
    contract.counts[row.severity] += 1
    contract.total += 1
    if (SEVERITY_RANK[row.severity] > SEVERITY_RANK[contract.topSeverity]) {
      contract.topSeverity = row.severity
    }
    contract.findings.push(row)
  }

  const contracts = [...byContract.values()]
  for (const contract of contracts) {
    contract.findings.sort(byRiskThenTitle)
  }

  // Contracts rank by worst severity present, then by how many high/total
  // findings they carry, then title -- so the most exposed contract leads.
  contracts.sort((a, b) => {
    const top = SEVERITY_RANK[b.topSeverity] - SEVERITY_RANK[a.topSeverity]
    if (top !== 0) return top
    const high = b.counts.high - a.counts.high
    if (high !== 0) return high
    const total = b.total - a.total
    if (total !== 0) return total
    return a.contractTitle.localeCompare(b.contractTitle)
  })

  const findings = [...rows].sort((a, b) => {
    const rank = byRiskThenTitle(a, b)
    return rank !== 0 ? rank : a.contractTitle.localeCompare(b.contractTitle)
  })

  return {
    total: rows.length,
    counts,
    contractsAffected: byContract.size,
    contracts,
    findings,
  }
}
