// tests/ai/assistant-prompts.test.ts
//
// Prompt rules are load-bearing behaviour that no type checks and no other
// test covers -- delete a line and everything still compiles, every other
// test still passes, and the assistant quietly starts doing the thing the
// line existed to stop. Each rule asserted here was added because a live run
// produced the failure it prevents.
import { describe, it, expect } from 'vitest'
import { contractPrompt, portfolioPrompt, extractCitationOrdinals } from '@/lib/ai/prompts'

const CONTEXT = 'CONTRACT "Orion MSA"\n  effective date: 2026-09-01 (stated in the contract)'

describe('extractCitationOrdinals :: the grouped form', () => {
  // A live portfolio answer wrote "2 high-severity findings [30, 31]" and BOTH
  // citations were dropped, because the pattern only matched a lone number.
  // The answer still rendered and still looked cited -- a grounding failure
  // that is invisible from the outside is the worst kind.
  it('reads the grouped citations a model writes naturally', () => {
    expect(extractCitationOrdinals('two findings [30, 31] and one more [35]')).toEqual([30, 31, 35])
    expect(extractCitationOrdinals('no spaces [4,5]')).toEqual([4, 5])
  })

  it('still reads single citations, and reports each ordinal once', () => {
    expect(extractCitationOrdinals('see [1] and [2], and again [1]')).toEqual([1, 2])
  })

  it('ignores bracketed text that is not a citation', () => {
    expect(extractCitationOrdinals('an aside [note] and [1]')).toEqual([1])
  })
})

describe('portfolioPrompt :: rules a live run proved necessary', () => {
  const { system } = portfolioPrompt('Which contracts need attention?', CONTEXT)

  // The P0: the assistant summed several stated fees into a total the
  // contract never states.
  it('forbids arithmetic outright, and names the fee-total case', () => {
    expect(system).toContain('NEVER perform arithmetic')
    expect(system).toMatch(/HAS NO TOTAL/)
  })

  it('refuses a bare aggregate and requires the items behind it', () => {
    expect(system).toContain('Never state a count, a ranking, or any other summary on its own')
    expect(system).toMatch(/ATTENTION ITEMS or RISK FINDINGS/)
  })

  // A live answer wrote "[contract=c9704933-70d7-...]" into user-facing prose.
  it('forbids writing identifiers into the answer', () => {
    expect(system).toMatch(/Never write an id, code, identifier or internal label/)
  })

  // A live Arabic question got an English answer, because every label and
  // title in the context is English.
  it('makes the question’s language outrank the data’s language', () => {
    expect(system).toMatch(/An Arabic question gets an Arabic answer/)
    expect(system).toContain('outranks everything about the data')
  })

  it('keeps an empty result distinct from having no source at all', () => {
    expect(system).toMatch(/is a real answer -- give it plainly/)
    expect(system).toMatch(/ONLY when the data below holds nothing of the kind/)
  })

  it('requires a computed date to travel with its derivation', () => {
    expect(system).toContain('may only appear alongside the derivation')
    expect(system).toMatch(/Never present a COMPUTED date as though the contract states it/)
  })

  it('requires naming the contracts whose deadlines were never extracted', () => {
    expect(system).toMatch(/you MUST say at the end which contracts those are/)
  })
})

describe('contractPrompt :: what the model is entitled to claim', () => {
  it('lets the model say the contract is silent only when it holds the whole document', () => {
    expect(contractPrompt('q', CONTEXT, 'full').system).toContain('COMPLETE contract')
    expect(contractPrompt('q', CONTEXT, 'full').system).toContain('genuinely does not say it')
  })

  // The weaker epistemic position: absence from these excerpts is not absence
  // from the document, and the prompt has to say which position it is in.
  it('holds the model to the weaker claim when it only has excerpts', () => {
    const { system } = contractPrompt('q', CONTEXT, 'retrieved')
    expect(system).toContain('NOT the whole contract')
    expect(system).toContain('rather than stating the contract is silent')
  })

  it('carries the same arithmetic prohibition as the portfolio scope', () => {
    expect(contractPrompt('q', CONTEXT, 'full').system).toContain('NEVER perform arithmetic')
  })

  // A live run answered "what are the risks in this contract?" with a bare
  // NOT_FOUND on a contract that had no stored analysis -- true, useless, and
  // easily read as "no risks".
  it('distinguishes "no analysis stored" from "no risk"', () => {
    // Both halves, in order: QA found that stating only the first lets
    // "none recorded" be read as "none exist".
    const { system } = contractPrompt('q', CONTEXT, 'full')
    expect(system).toContain('no risk findings are recorded for this contract')
    expect(system).toContain('NOT a finding that the contract is low-risk or free of risk')
  })

  it('does not put conversation history in the position of a source', () => {
    const { system } = contractPrompt('q', CONTEXT, 'full', [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ])
    expect(system).toContain('NOT a source of facts')
  })
})

describe('citations in the Arabic half of the product', () => {
  // A live Arabic answer cited "[37، 38]" using U+060C, the Arabic comma --
  // which is correct Arabic punctuation and exactly what an Arabic writer
  // should produce. Matching only the Latin comma dropped both citations
  // silently, the same class of bug formatDerivation's localized separator
  // exists to prevent.
  it('reads a grouped citation punctuated with the Arabic comma', () => {
    expect(extractCitationOrdinals('المخاطر [37، 38] والالتزام [30،31]')).toEqual([37, 38, 30, 31])
  })

  it('reads Latin and Arabic separators in the same answer', () => {
    expect(extractCitationOrdinals('[1, 2] and [3، 4]')).toEqual([1, 2, 3, 4])
  })

  // The same answer wrote "[عقد]" and "[حسب بيانات العقد]" -- bracketed
  // phrases that read as citations and resolve to nothing.
  it('both assistants reserve square brackets for citations alone', () => {
    for (const system of [portfolioPrompt('q', CONTEXT).system, contractPrompt('q', CONTEXT, 'full').system]) {
      expect(system).toContain('Square brackets mean one thing only')
    }
  })
})

describe('QA follow-up :: citation precision and presentation', () => {
  // The source index and the document's own clause label are different
  // numbers, and they sat adjacent and unlabelled as `[30] CLAUSE (29)`.
  it('tells the model the bracketed number is not the document’s clause label', () => {
    for (const system of [portfolioPrompt('q', CONTEXT).system, contractPrompt('q', CONTEXT, 'full').system]) {
      expect(system).toContain('It is NOT the document')
      expect(system).toMatch(/Never cite \[1\], or any record, as a default/)
    }
  })

  // A fact stated on a cover page AND in the operative clause should cite the
  // clause -- a reader following a citation wants the provision.
  it('prefers the operative clause over a summary that repeats it', () => {
    expect(contractPrompt('q', CONTEXT, 'full').system).toContain('cite the operative clause')
  })

  // QA: Arabic answers leaked "(Provider)" and "(Clause 32)" as bare English.
  it('requires Arabic answers to be structurally Arabic, defined terms aside', () => {
    for (const system of [portfolioPrompt('q', CONTEXT).system, contractPrompt('q', CONTEXT, 'full').system]) {
      expect(system).toContain('the STRUCTURE of the sentence is Arabic too')
      expect(system).toContain('البند 32')
    }
  })

  it('asks for a multi-part question to be answered part by part', () => {
    for (const system of [portfolioPrompt('q', CONTEXT).system, contractPrompt('q', CONTEXT, 'full').system]) {
      expect(system).toContain('each under its own short heading line')
    }
  })

  // QA: "none recorded" must never be readable as "none exist".
  it('spells out both halves of the no-findings answer', () => {
    const { system } = contractPrompt('q', CONTEXT, 'full')
    expect(system).toContain('no risk analysis has been stored')
    expect(system).toContain('NOT a finding that the contract is low-risk')
  })
})
