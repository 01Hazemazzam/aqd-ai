// Verifies risk findings against the clauses they claim to come from, so a
// finding's grounding is checked in code rather than trusted from the prompt.
//
// The analysis prompt asks the model to quote, verbatim, the words a finding
// is based on. That request alone guarantees nothing: a model that invents a
// finding will just as happily invent the quote. This module is the check --
// a finding survives only if the clause it cites exists AND the words it
// quotes are genuinely in that clause. Everything else is dropped with a
// reason, which is what makes "exact evidence for every finding" a property
// of the system instead of a hope.
//
// Pure and deterministic: a function of (findings, clauses) alone, so every
// rule below is unit-testable through this one interface.

export type Severity = 'high' | 'medium' | 'low'

/** A finding exactly as it came back from the model, before any trust. */
export interface RawFinding {
  clauseId: string | null
  ruleKey: string | null
  severity: string
  title: string
  reason: string
  reasonAr?: string | null
  /** Verbatim excerpt from the cited clause; null for a missing-clause finding. */
  evidence?: string | null
}

export interface VerifiedFinding {
  clauseId: string | null
  ruleKey: string | null
  severity: Severity
  title: string
  reason: string
  reasonAr: string | null
  evidence: string | null
}

export type RejectionReason =
  /** Cited a clause id that was never given to the model. */
  | 'unknown_clause'
  /** Anchored to a clause but quoted nothing. */
  | 'missing_evidence'
  /** Quoted words that do not appear in the cited clause. */
  | 'evidence_not_in_clause'
  /** severity was not one of high/medium/low. */
  | 'bad_severity'
  /** No title or no reason to show. */
  | 'empty_content'

export interface RejectedFinding {
  finding: RawFinding
  reason: RejectionReason
}

export interface VerificationResult {
  kept: VerifiedFinding[]
  rejected: RejectedFinding[]
}

const SEVERITIES: readonly string[] = ['high', 'medium', 'low']

// Models reflow whitespace, swap straight quotes for curly ones, and drop or
// add the odd bracket when quoting. None of that changes whether the quote is
// really in the clause, so both sides are normalized before comparison:
// whitespace collapsed, quote/dash variants folded, case removed. What is NOT
// forgiven is different *words* -- that is exactly the hallucination this
// module exists to catch.
function normalize(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[  -   　]/g, ' ')
    // Arabic tatweel is decorative elongation and carries no meaning.
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// An ellipsis is the one legitimate way a quote can skip text, so "A ... B"
// is checked as: A appears, then B appears after it.
function containsQuote(haystack: string, quote: string): boolean {
  const segments = quote
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return false

  let cursor = 0
  for (const segment of segments) {
    const at = haystack.indexOf(segment, cursor)
    if (at === -1) return false
    cursor = at + segment.length
  }
  return true
}

// Below this a "quote" carries no evidential weight -- a model can land on
// "the" or "shall" in any clause by accident, which would let a fabricated
// finding pass the substring check on a coincidence.
const MIN_EVIDENCE_CHARS = 12

export function verifyFindings(findings: RawFinding[], clauses: Array<{ id: string; body: string }>): VerificationResult {
  const bodyById = new Map(clauses.map((c) => [c.id, normalize(c.body)]))
  const kept: VerifiedFinding[] = []
  const rejected: RejectedFinding[] = []

  for (const finding of findings) {
    const title = (finding.title ?? '').trim()
    const reason = (finding.reason ?? '').trim()
    if (!title || !reason) {
      rejected.push({ finding, reason: 'empty_content' })
      continue
    }

    if (!SEVERITIES.includes(finding.severity)) {
      rejected.push({ finding, reason: 'bad_severity' })
      continue
    }

    const evidence = (finding.evidence ?? '').trim()

    // A finding about a clause the document never includes has nothing to
    // quote -- that is the one case where absent evidence is correct. Any
    // quote it did supply is discarded rather than stored, since there is no
    // clause to have taken it from.
    if (finding.clauseId === null) {
      kept.push({
        clauseId: null,
        ruleKey: finding.ruleKey ?? null,
        severity: finding.severity as Severity,
        title,
        reason,
        reasonAr: finding.reasonAr?.trim() || null,
        evidence: null,
      })
      continue
    }

    const body = bodyById.get(finding.clauseId)
    if (body === undefined) {
      rejected.push({ finding, reason: 'unknown_clause' })
      continue
    }

    if (evidence.length < MIN_EVIDENCE_CHARS) {
      rejected.push({ finding, reason: 'missing_evidence' })
      continue
    }

    if (!containsQuote(body, normalize(evidence))) {
      rejected.push({ finding, reason: 'evidence_not_in_clause' })
      continue
    }

    kept.push({
      clauseId: finding.clauseId,
      ruleKey: finding.ruleKey ?? null,
      severity: finding.severity as Severity,
      title,
      reason,
      reasonAr: finding.reasonAr?.trim() || null,
      evidence,
    })
  }

  return { kept, rejected }
}
