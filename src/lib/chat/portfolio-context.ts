// The grounded context assembly layer for portfolio-scope questions.
//
// One function turns the Intelligence bundle into the exact text the model
// sees plus the map from every [n] back to the record it points at. Those two
// outputs are built together on purpose -- a numbering scheme in one module
// and a citation resolver in another is a silent mis-citation waiting to
// happen, where [3] renders as a link to whatever record happens to be third
// somewhere else.
//
// Only records that can be cited are numbered. That is the evidence-first
// rule taken literally: a claim with no clause and no finding behind it gets
// no ordinal, so the prompt has no way to reference it as a fact. Lifecycle
// dates are the one thing that escapes this, and they escape it through the
// COMPUTED rule instead -- see renderContractFacts in ./render.

import {
  contractFactsFor,
  renderAttentionItem,
  renderContractFacts,
  renderFinding,
  renderObligation,
  resolveSourceCitations,
  tierReason,
  type Source,
} from './render'
import type { IntelligenceBundle } from '@/lib/intelligence/load'

/** Indents a multi-line record so it reads as belonging to its contract. */
function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

export type { Source, SourceTarget, ResolvedSourceCitation } from './render'

export interface PortfolioContext {
  /** The context block, ready to drop into the prompt. */
  text: string
  sources: Source[]
  /** Titles of in-scope contracts whose analysis predates due-spec
      extraction, so their obligations contributed no dates. Named rather than
      counted: "two contracts are incomplete" is not actionable, and an answer
      that silently speaks for 4 of 12 contracts is worse than one that says
      which 8 it could not read. */
  incomplete: string[]
}

/**
 * Assemble every portfolio-scope source into one context block.
 *
 * Takes the whole bundle rather than a pre-narrowed selection: at the current
 * corpus size the entire portfolio is about 1% of the model's context, so
 * choosing what to send costs more than sending it. `narrow` is the seam for
 * when that stops being true -- it is where retrieval goes, and it is a
 * parameter rather than a TODO so the shape is already right.
 */
export function assemblePortfolioContext(
  bundle: IntelligenceBundle,
  narrow: (bundle: IntelligenceBundle) => IntelligenceBundle = (b) => b,
): PortfolioContext {
  const narrowed = narrow(bundle)
  const { intelligence, findings } = narrowed
  const sources: Source[] = []
  const blocks: string[] = []

  const c = intelligence.counts
  blocks.push(
    [
      'PORTFOLIO TOTALS (aggregated over the contracts below):',
      `  contracts analysed: ${c.contracts}`,
      `  contracts whose analysis is outdated: ${c.outdated}`,
      `  obligations with a computed deadline: ${c.resolvedDeadlines}`,
      `  obligations with no derivable deadline: ${c.unresolvedDeadlines}`,
      `  dated milestones already past: ${c.overdue}`,
      `  dated milestones within 30 days: ${c.soon}`,
      `  attention items (a clause carrying both a risk finding and an obligation): ${c.attention}`,
    ].join('\n'),
  )

  // Everything about a contract is rendered UNDER that contract, with its
  // records numbered in place. The first version put all findings in one
  // distant block and all obligations in another, and a live run produced an
  // answer naming three contracts with ZERO citations -- the evidence was
  // there, but nothing connected it to the contract the claim was about. The
  // ordinals stay globally unique and contiguous; only the layout changed.
  for (const row of intelligence.contracts) {
    const facts = contractFactsFor(narrowed, row.contractId, [`why it ranks where it does: ${tierReason(row.tier)}`])
    if (!facts) continue

    const lines = [renderContractFacts(facts)]

    const contractFindings = findings.filter((f) => f.contractId === row.contractId)
    if (contractFindings.length) {
      lines.push('  RISK FINDINGS (each verified against the clause it quotes):')
      for (const f of contractFindings) {
        const ordinal = sources.length + 1
        sources.push({
          ordinal,
          contractId: f.contractId,
          // A finding anchored to a clause cites the clause, so the reader
          // lands on the words. Only a finding about an ABSENT clause cites
          // itself -- there is nothing else to point at.
          target: f.clauseId ? { kind: 'clause', clauseId: f.clauseId } : { kind: 'finding', findingId: f.id },
        })
        lines.push(indent(renderFinding(f, ordinal)))
      }
    }

    const contractAttention = intelligence.attention.filter((a) => a.contractId === row.contractId)
    if (contractAttention.length) {
      lines.push('  ATTENTION ITEMS -- this is what "needs attention" means, and what to cite when you say a contract does:')
      for (const a of contractAttention) {
        const ordinal = sources.length + 1
        sources.push({ ordinal, contractId: a.contractId, target: { kind: 'clause', clauseId: a.clauseId } })
        lines.push(indent(renderAttentionItem(a, ordinal)))
      }
    }

    const contractObligations = intelligence.obligations.filter((o) => o.contractId === row.contractId && o.clauseId)
    if (contractObligations.length) {
      lines.push('  OBLIGATIONS:')
      for (const o of contractObligations) {
        const ordinal = sources.length + 1
        sources.push({ ordinal, contractId: o.contractId, target: { kind: 'clause', clauseId: o.clauseId! } })
        lines.push(indent(renderObligation(o, ordinal)))
      }
    }

    blocks.push(lines.join('\n'))
  }

  return {
    text: blocks.join('\n\n'),
    sources,
    incomplete: intelligence.contracts.filter((x) => !x.current).map((x) => x.title),
  }
}

export const resolvePortfolioCitations = resolveSourceCitations
