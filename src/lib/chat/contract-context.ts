// The grounded context assembly layer for contract-scope questions.
//
// Two things changed here from the retrieval-only design that preceded it.
//
// First, the whole document is sent when it fits. Top-6 retrieval capped
// multi-clause reasoning at whatever six chunks an embedding happened to
// pull, and -- worse -- made NOT_FOUND ambiguous: it could mean "the document
// does not say" OR "retrieval missed it", which are completely different
// statements to make to a lawyer. With the whole contract in context,
// NOT_FOUND becomes truthful, and the model can no longer be right-but-
// uncited about a clause it was never shown.
//
// Second, the contract's own findings and obligations travel with it, in the
// same three registers the portfolio context uses. "What are the risks here?"
// and "who owes what?" are contract-scope questions, and answering them from
// clause text alone would mean re-deriving, at answer time and ungrounded,
// work the analysis pipeline already did and verified.
//
// The budget is characters of clause text, not tokens: deterministic, free to
// compute, and honest about what it measures. It is injectable so the
// retrieval path is reachable from a test -- a fallback that never executes
// in CI is a fallback that has already rotted by the time the first oversized
// contract arrives.

import type { LoadedFinding } from '@/lib/intelligence/load'
import type { TrackedObligation } from '@/lib/intelligence/build'
import { renderContractFacts, renderFinding, renderObligation, resolveSourceCitations, type ContractFacts, type Source } from './render'

export type { ContractFacts } from './render'

/** Roughly six times the largest contract in the current corpus (10.4 KB),
    which puts the whole document at about 1.8% of the model's context. The
    number is a safety margin, not a tuning knob. */
export const CLAUSE_BUDGET_CHARS = Number(process.env.CHAT_CLAUSE_BUDGET_CHARS ?? 60_000)

export interface ContextClause {
  id: string
  clauseNumber: string | null
  lang: 'ar' | 'en'
  body: string
}

export interface ContractContext {
  text: string
  sources: Source[]
  /** 'full' when the entire document is in context, 'retrieved' when only the
      clauses retrieval selected are. The route uses this to decide whether
      the condense step is worth running at all, and the answer's NOT_FOUND
      means something slightly weaker in 'retrieved' mode. */
  mode: 'full' | 'retrieved'
}

/**
 * Does the whole document fit?
 *
 * Separate from the assembly so the route can decide whether to retrieve
 * BEFORE paying for an embedding call it may not need.
 */
export function fitsBudget(clauses: Array<{ body: string }>, budget: number = CLAUSE_BUDGET_CHARS): boolean {
  let total = 0
  for (const c of clauses) {
    total += c.body.length
    if (total > budget) return false
  }
  return true
}

function renderClause(c: ContextClause, ordinal: number): string {
  const number = c.clauseNumber ? ` (${c.clauseNumber})` : ''
  return `[${ordinal}] CLAUSE${number}\n${c.body}`
}

/**
 * Assemble one contract's context: its clauses, its findings, its obligations.
 *
 * `clauses` is either every clause in the document or the retrieved subset;
 * `mode` says which, and is the caller's assertion rather than something
 * inferred here.
 */
export function assembleContractContext(
  clauses: ContextClause[],
  findings: LoadedFinding[],
  obligations: TrackedObligation[],
  facts: ContractFacts,
  mode: 'full' | 'retrieved',
): ContractContext {
  const sources: Source[] = []
  const blocks: string[] = [renderContractFacts(facts)]

  const clauseLines: string[] = []
  for (const c of clauses) {
    const ordinal = sources.length + 1
    sources.push({ ordinal, contractId: facts.contractId, target: { kind: 'clause', clauseId: c.id } })
    clauseLines.push(renderClause(c, ordinal))
  }
  blocks.push(
    mode === 'full'
      ? `CLAUSES -- this is the COMPLETE document, every clause of it:\n${clauseLines.join('\n\n')}`
      : `CLAUSES -- these are the excerpts retrieved as relevant to this question, NOT the whole document:\n${clauseLines.join('\n\n')}`,
  )

  const findingLines: string[] = []
  for (const f of findings) {
    const ordinal = sources.length + 1
    sources.push({
      ordinal,
      contractId: f.contractId,
      target: f.clauseId ? { kind: 'clause', clauseId: f.clauseId } : { kind: 'finding', findingId: f.id },
    })
    findingLines.push(renderFinding(f, ordinal))
  }
  blocks.push(
    findingLines.length
      ? `RISK FINDINGS for this contract (each verified against the clause it quotes):\n${findingLines.join('\n')}`
      : // Stated rather than omitted. A live run answered "what are the risks
        // in this contract?" with a bare NOT_FOUND -- a true statement the
        // user cannot act on, because it reads as "no risks" when it means
        // "no analysis". An absence has to be visible to be reportable.
        `RISK FINDINGS for this contract: NONE RECORDED. No risk analysis is stored for this contract, so this is an absence of ANALYSIS, not evidence that the contract is low-risk. If asked about risks, say exactly that -- do not refuse, and do not assess the clauses yourself to fill the gap.`,
  )

  const obligationLines: string[] = []
  for (const o of obligations) {
    if (!o.clauseId) continue
    const ordinal = sources.length + 1
    sources.push({ ordinal, contractId: o.contractId, target: { kind: 'clause', clauseId: o.clauseId } })
    obligationLines.push(renderObligation(o, ordinal))
  }
  blocks.push(
    obligationLines.length
      ? `OBLIGATIONS for this contract:\n${obligationLines.join('\n')}`
      : `OBLIGATIONS for this contract: NONE EXTRACTED. Duties stated in the clause text above are still real and still citable -- this means only that no extraction is stored.`,
  )

  return { text: blocks.join('\n\n'), sources, mode }
}

/** The contract-scope citation resolver -- the same rule as the portfolio
    one, and literally the same function: an ordinal the model was not shown
    resolves to nothing. */
export const resolveContractCitations = resolveSourceCitations
