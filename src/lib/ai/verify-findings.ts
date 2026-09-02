// Verifies risk findings against the clauses they claim to come from, so a
// finding's grounding is checked in code rather than trusted from the prompt.
//
// The analysis prompts ask the model to quote, verbatim, the words a finding
// is based on. That request alone guarantees nothing: a model that invents a
// finding will just as happily invent the quote. This module is the check --
// a finding survives only if every clause it cites exists AND every quote it
// gives is genuinely in the clause it is attributed to. Everything else is
// dropped with a reason, which is what makes "exact evidence for every
// finding" a property of the system instead of a hope.
//
// Evidence is a LIST of spans because the hardest findings are about the
// relationship between clauses. "Customer may terminate for convenience" is
// not evidence of one-sidedness by itself; it becomes evidence only beside
// the clause that gives the other party no equivalent right. A single-clause
// playbook finding is just the one-span case of the same shape.
//
// Pure and deterministic: a function of (findings, clauses) alone, so every
// rule below is unit-testable through this one interface.

export type Severity = 'high' | 'medium' | 'low'

/** What sort of reasoning produced a finding. Mirrors public.finding_kind. */
export type FindingKind = 'playbook' | 'asymmetry' | 'contradiction' | 'dependency'

/** Kinds that make a claim about the document's structure rather than about
    a rule. All of them must be anchored to real text. */
const RELATIONAL_KINDS: readonly FindingKind[] = ['asymmetry', 'contradiction', 'dependency']

// A contradiction or a dependency is a claim about two LOCATIONS -- "this
// clause says 72 hours, that one says 48", "this cap is swallowed by that
// exclusion" -- and cannot be shown from a single clause, so one is required
// from each. Asymmetry deliberately is not on this list: a well-drafted
// contract often states both sides in one clause ("Customer may terminate
// for convenience... Provider has no express equivalent right"), and an
// earlier version of this rule threw exactly that finding away. Requiring
// two clauses there traded a false positive for a false negative on the
// clearest evidence a contract can offer.
const TWO_CLAUSE_KINDS: readonly FindingKind[] = ['contradiction', 'dependency']

const KINDS: readonly string[] = ['playbook', 'asymmetry', 'contradiction', 'dependency']

export interface RawEvidenceSpan {
  clauseId?: string | null
  quote?: string | null
}

/** A finding exactly as it came back from the model, before any trust. */
export interface RawFinding {
  kind?: string | null
  ruleKey?: string | null
  severity: string
  title: string
  reason: string
  reasonAr?: string | null
  /** One entry per clause quoted. Empty only for a missing-clause finding. */
  evidence?: RawEvidenceSpan[] | null
}

export interface VerifiedSpan {
  clauseId: string
  quote: string
}

export interface VerifiedFinding {
  kind: FindingKind
  /** The clause this finding is anchored to -- the first span's clause, or
      null for a finding about a clause the document does not contain. */
  clauseId: string | null
  ruleKey: string | null
  severity: Severity
  title: string
  reason: string
  reasonAr: string | null
  evidence: VerifiedSpan[]
}

export type RejectionReason =
  /** Cited a clause id that was never given to the model. */
  | 'unknown_clause'
  /** A span with no usable quote. */
  | 'missing_evidence'
  /** Quoted words that do not appear in the cited clause. */
  | 'evidence_not_in_clause'
  /** A relational finding that pointed at fewer than two distinct clauses. */
  | 'insufficient_spans'
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
  return (
    text
      .replace(/[‘’‛′]/g, "'")
      .replace(/[“”‟″]/g, '"')
      .replace(/[‐-―−]/g, '-')
      .replace(/[  -   　]/g, ' ')
      // Arabic tatweel is decorative elongation and carries no meaning.
      .replace(/ـ/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  )
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

/** Verifying one span. Returns the rejection reason, or null when it holds. */
function verifySpan(
  span: RawEvidenceSpan,
  bodyById: Map<string, string>,
): { span: VerifiedSpan } | { reason: RejectionReason } {
  const clauseId = span.clauseId ?? null
  const quote = (span.quote ?? '').trim()

  if (!clauseId) return { reason: 'unknown_clause' }
  const body = bodyById.get(clauseId)
  if (body === undefined) return { reason: 'unknown_clause' }
  if (quote.length < MIN_EVIDENCE_CHARS) return { reason: 'missing_evidence' }
  if (!containsQuote(body, normalize(quote))) return { reason: 'evidence_not_in_clause' }

  return { span: { clauseId, quote } }
}

export function verifyFindings(
  findings: RawFinding[],
  clauses: Array<{ id: string; body: string }>,
): VerificationResult {
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

    // An unrecognized kind is not worth dropping a real finding over -- the
    // playbook pass is the conservative reading, and it only costs the
    // finding its relational label.
    const kind = (KINDS.includes(finding.kind ?? '') ? finding.kind : 'playbook') as FindingKind
    const rawSpans = finding.evidence ?? []

    // A finding about a clause the document never includes has nothing to
    // quote -- that is the one case where absent evidence is correct. It
    // cannot be a relational finding, since there is no second clause.
    if (rawSpans.length === 0) {
      if (RELATIONAL_KINDS.includes(kind)) {
        rejected.push({ finding, reason: 'insufficient_spans' })
        continue
      }
      kept.push({
        kind,
        clauseId: null,
        ruleKey: finding.ruleKey ?? null,
        severity: finding.severity as Severity,
        title,
        reason,
        reasonAr: finding.reasonAr?.trim() || null,
        evidence: [],
      })
      continue
    }

    // Every span must hold. A claim resting on one real quote and one
    // invented one is an invented claim -- keeping its verifiable half would
    // present a fabrication as partially sourced, which is worse than
    // dropping it.
    const spans: VerifiedSpan[] = []
    let failure: RejectionReason | null = null
    for (const raw of rawSpans) {
      const result = verifySpan(raw, bodyById)
      if ('reason' in result) {
        failure = result.reason
        break
      }
      spans.push(result.span)
    }
    if (failure) {
      rejected.push({ finding, reason: failure })
      continue
    }

    if (TWO_CLAUSE_KINDS.includes(kind) && new Set(spans.map((s) => s.clauseId)).size < 2) {
      rejected.push({ finding, reason: 'insufficient_spans' })
      continue
    }

    kept.push({
      kind,
      clauseId: spans[0].clauseId,
      ruleKey: finding.ruleKey ?? null,
      severity: finding.severity as Severity,
      title,
      reason,
      reasonAr: finding.reasonAr?.trim() || null,
      evidence: spans,
    })
  }

  return { kept, rejected }
}
