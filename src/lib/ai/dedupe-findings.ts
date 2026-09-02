// Drops cross-clause findings that only restate what the playbook pass
// already reported.
//
// The two risk passes read the same contract with different briefs, and on a
// badly one-sided contract they converge: the playbook pass reports "one-
// sided indemnification" against clause 12, and the cross-clause pass
// reports the same imbalance, in the same clause, as an asymmetry. Both are
// true and both are grounded, so the verifier keeps both -- and the reader
// gets six rows describing three risks. Duplicated risk is its own kind of
// false positive: it inflates the count, buries the findings that are
// genuinely distinct, and makes the analysis look padded.
//
// Asking the prompt not to duplicate does not survive contact with a real
// contract (it was already asked). This is the deterministic version of that
// instruction.
//
// The test is what the finding CITES, not what it says: a relational finding
// earns its place when it points somewhere the playbook finding does not. A
// finding about clauses 11 AND 12 says something neither single-clause
// finding can -- how they combine. A finding about clause 12 alone, next to
// a playbook finding about clause 12, says nothing new no matter how it is
// worded.

import type { VerifiedFinding } from './verify-findings'

export interface DedupeResult {
  kept: VerifiedFinding[]
  dropped: VerifiedFinding[]
}

function clauseSet(finding: VerifiedFinding): Set<string> {
  return new Set(finding.evidence.map((e) => e.clauseId))
}

function isSubsetOf(inner: Set<string>, outer: Set<string>): boolean {
  for (const id of inner) if (!outer.has(id)) return false
  return true
}

export function dropRedundantRelational(findings: VerifiedFinding[]): DedupeResult {
  const playbookSets = findings.filter((f) => f.kind === 'playbook').map(clauseSet)

  const kept: VerifiedFinding[] = []
  const dropped: VerifiedFinding[] = []

  for (const finding of findings) {
    if (finding.kind === 'playbook') {
      kept.push(finding)
      continue
    }

    const cites = clauseSet(finding)
    // An unanchored relational finding cites nothing, so it cannot be shown
    // to add anything -- but it also cannot be shown to duplicate anything.
    // Keeping it costs one row; dropping it could lose a real finding.
    const redundant = cites.size > 0 && playbookSets.some((covered) => isSubsetOf(cites, covered))

    if (redundant) dropped.push(finding)
    else kept.push(finding)
  }

  return { kept, dropped }
}
