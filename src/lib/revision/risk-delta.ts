// What the redline did to the risk profile.
//
// The clause diff says a paragraph changed; this says whether that was good
// or bad news. It is the reason the comparison view is worth opening at all:
// "clause 12 was modified" is information, "the liability cap finding is gone
// and a new high-severity indemnity finding appeared" is a decision.
//
// Two honesty constraints shape the whole module.
//
// First, a finding that stops appearing has NOT necessarily been fixed. The
// analysis is a model's reading, re-run over different text; it can change
// its mind. So nothing here is called "resolved" -- the field says exactly
// what is observed, that the finding is no longer reported, and the UI says
// the same.
//
// Second, findings are matched by their playbook rule wherever they have one,
// because that is a stable identity the analysis did not invent. The
// cross-clause findings (asymmetry, contradiction, dependency) have no rule
// key and fall back to their title, which is weaker: a re-worded title for
// the same underlying problem reads as one finding leaving and another
// arriving. That is the conservative direction to be wrong in -- it
// over-reports change rather than hiding it.

export type Severity = 'high' | 'medium' | 'low'

export interface DeltaFinding {
  id: string
  ruleKey: string | null
  kind: string
  severity: Severity
  title: string
}

export interface SeverityCounts {
  high: number
  medium: number
  low: number
}

export interface CarriedFinding {
  base: DeltaFinding
  revised: DeltaFinding
  /** Whether the same finding is now graded harder or softer than it was. */
  severityChange: 'worse' | 'better' | 'same'
}

export interface RiskDelta {
  /** Reported against the revision and not against the base version. */
  introduced: DeltaFinding[]
  /** Reported against the base version and not against the revision. Not the
      same claim as "fixed" -- see the note at the top of this file. */
  noLongerReported: DeltaFinding[]
  carried: CarriedFinding[]
  counts: { base: SeverityCounts; revised: SeverityCounts }
  /** The risk profile is unchanged in both directions. */
  unchanged: boolean
}

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 }

/** A playbook rule identifies a finding across versions; a title only
    approximates one. Kind is part of the key either way, so a playbook
    finding and a cross-clause finding that happen to share wording are never
    mistaken for each other. */
function identity(f: DeltaFinding): string {
  return f.ruleKey ? `rule:${f.ruleKey}` : `${f.kind}:${f.title.trim().replace(/\s+/g, ' ').toLowerCase()}`
}

function tally(findings: DeltaFinding[]): SeverityCounts {
  const counts: SeverityCounts = { high: 0, medium: 0, low: 0 }
  for (const f of findings) counts[f.severity]++
  return counts
}

const worstFirst = (a: DeltaFinding, b: DeltaFinding) => RANK[b.severity] - RANK[a.severity] || a.title.localeCompare(b.title)

/**
 * Pair the risk findings of two analyses of the same contract.
 *
 * Both lists come from a single contract's own analyses; passing findings
 * from two different contracts is meaningless rather than wrong, and nothing
 * here can detect it.
 */
export function compareRiskFindings(base: DeltaFinding[], revised: DeltaFinding[]): RiskDelta {
  // Queued per identity so a rule that fires twice against one document (two
  // separate uncapped-liability clauses, say) pairs one with one rather than
  // collapsing both into a single finding.
  const remaining = new Map<string, DeltaFinding[]>()
  for (const f of base) {
    const key = identity(f)
    const bucket = remaining.get(key)
    if (bucket) bucket.push(f)
    else remaining.set(key, [f])
  }

  const introduced: DeltaFinding[] = []
  const carried: CarriedFinding[] = []
  const matchedBase = new Set<string>()

  for (const f of revised) {
    const bucket = remaining.get(identity(f))
    const partner = bucket?.shift()
    if (!partner) {
      introduced.push(f)
      continue
    }
    matchedBase.add(partner.id)
    const delta = RANK[f.severity] - RANK[partner.severity]
    carried.push({
      base: partner,
      revised: f,
      severityChange: delta > 0 ? 'worse' : delta < 0 ? 'better' : 'same',
    })
  }

  const noLongerReported = base.filter((f) => !matchedBase.has(f.id))

  return {
    introduced: [...introduced].sort(worstFirst),
    noLongerReported: [...noLongerReported].sort(worstFirst),
    // Worst first, and within that the findings whose grade moved, because a
    // carried finding that got harder is the one a reader needs to see.
    carried: [...carried].sort(
      (a, b) =>
        RANK[b.revised.severity] - RANK[a.revised.severity] ||
        Number(b.severityChange !== 'same') - Number(a.severityChange !== 'same') ||
        a.revised.title.localeCompare(b.revised.title),
    ),
    counts: { base: tally(base), revised: tally(revised) },
    unchanged: introduced.length === 0 && noLongerReported.length === 0 && carried.every((c) => c.severityChange === 'same'),
  }
}
