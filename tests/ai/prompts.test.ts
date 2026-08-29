// tests/ai/prompts.test.ts
import { describe, it, expect } from 'vitest'
import {
  extractJson,
  MalformedAiResponseError,
  summaryPrompt,
  fieldsPrompt,
  risksPrompt,
  obligationsPrompt,
  chatPrompt,
  isNotFoundAnswer,
  extractCitationOrdinals,
  resolveCitations,
} from '@/lib/ai/prompts'

describe('extractJson', () => {
  it('parses a plain JSON response', () => {
    expect(extractJson('summary', '{"summary":"hi"}')).toEqual({ summary: 'hi' })
  })

  it('strips a markdown code fence around the JSON', () => {
    expect(extractJson('summary', '```json\n{"summary":"hi"}\n```')).toEqual({ summary: 'hi' })
  })

  it('strips a fence with no language tag', () => {
    expect(extractJson('summary', '```\n{"summary":"hi"}\n```')).toEqual({ summary: 'hi' })
  })

  it('throws MalformedAiResponseError on invalid JSON', () => {
    expect(() => extractJson('summary', 'not json at all')).toThrow(MalformedAiResponseError)
  })

  it('repairs a stray backslash that is not a valid JSON escape (e.g. inside Arabic text) instead of failing', () => {
    // A real Gemini response failed with exactly this: "Bad Unicode escape
    // in JSON" from a malformed \u sequence inside a reasonAr string.
    const broken = '{"reasonAr": "\\u062f\\Xinvalid"}'
    expect(extractJson('risks', broken)).toEqual({ reasonAr: 'د\\Xinvalid' })
  })

  it('still fails on JSON that is broken for a reason other than a stray backslash', () => {
    expect(() => extractJson('summary', '{"summary": "unterminated')).toThrow(MalformedAiResponseError)
  })
})

describe('prompt builders', () => {
  it('does not leak internal clause ids into the summary or fields prompts', () => {
    const clause = { id: 'abc-123', clauseNumber: '1', body: 'Definitions clause.' }
    expect(summaryPrompt([clause]).user).not.toContain('abc-123')
    expect(fieldsPrompt([clause]).user).not.toContain('abc-123')
    expect(summaryPrompt([clause]).user).toContain('Definitions clause.')
  })

  it('embeds each clause id in the risks and obligations prompts, which reference clauses by id', () => {
    const clause = { id: 'abc-123', clauseNumber: '1', body: 'Definitions clause.' }
    expect(
      risksPrompt([clause], [{ ruleKey: 'x', title: 'x', description: 'x', severityHint: 'low' }]).user,
    ).toContain('abc-123')
    expect(obligationsPrompt([clause]).user).toContain('abc-123')
  })

  it('embeds the playbook rule list in the risks system prompt', () => {
    const { system } = risksPrompt(
      [{ id: 'c1', clauseNumber: '1', body: 'text' }],
      [{ ruleKey: 'termination_clause', title: 'Termination rights', description: 'desc', severityHint: 'high' }],
    )
    expect(system).toContain('termination_clause')
    expect(system).toContain('Termination rights')
  })

  it('instructs the model not to misapply an imbalance rule to a clause type\'s mere absence', () => {
    // Regression lock for a real false positive: gemini-flash-lite-latest
    // flagged "indemnification_balance" and "unilateral_amendment" (both
    // scoped to an EXISTING one-sided clause) when the contract simply had
    // no such clause at all. Fixed by adding this instruction with concrete
    // examples; this test only guards the instruction's presence -- the
    // live-model behavior itself is re-verified in qa/RESULTS.md, not here.
    const { system } = risksPrompt(
      [{ id: 'c1', clauseNumber: '1', body: 'text' }],
      [{ ruleKey: 'indemnification_balance', title: 'x', description: 'x', severityHint: 'medium' }],
    )
    expect(system).toContain('absent')
    expect(system).toContain('indemnification')
    expect(system.toLowerCase()).toContain('not a violation')
  })

  it('instructs the model to match the document\'s language and not leave English structural words in Arabic prose', () => {
    // Regression lock for a real bug: a Contract-B summary correctly wrote
    // in Arabic but left the English word "clause" in its citations
    // (e.g. "(clause 1, clause 3)"). Also regression-locks that the
    // language-neutral clause marker doesn't reintroduce the same word.
    const clause = { id: 'c1', clauseNumber: '1', body: 'نص العقد' }
    expect(summaryPrompt([clause]).system.toLowerCase()).toContain('arabic')
    expect(summaryPrompt([clause]).user).not.toMatch(/\bclause\b/i)
  })
})

describe('chatPrompt', () => {
  it('numbers retrieved clauses 1..N in retrieval order, not by clause_number', () => {
    const { system } = chatPrompt('When can this be terminated?', [
      { clauseNumber: '7', lang: 'en', body: 'Termination text.' },
      { clauseNumber: '2', lang: 'en', body: 'Some other clause.' },
    ])
    expect(system).toContain('[1]\nTermination text.')
    expect(system).toContain('[2]\nSome other clause.')
  })

  it('instructs NOT_FOUND for a question the clauses cannot answer', () => {
    const { system } = chatPrompt('q', [])
    expect(system).toContain('NOT_FOUND')
  })

  it('passes the raw question through as the user turn', () => {
    const { user } = chatPrompt('What is the governing law?', [])
    expect(user).toBe('What is the governing law?')
  })

  // A live QA-MIX run asked an English question grounded only in an Arabic
  // clause and got an Arabic answer back -- the model followed the clause's
  // language instead of the question's. The instruction now says explicitly
  // this must not happen, with the exact failing case as a worked example.
  it('explicitly instructs answering in the question language even when the grounding clause is in a different language', () => {
    const { system } = chatPrompt('q', [])
    expect(system).toMatch(/even when the clause.*different language/i)
    expect(system).toContain('an English question grounded in an Arabic clause still gets an English answer')
  })
})

describe('isNotFoundAnswer', () => {
  it('matches an exact NOT_FOUND response', () => {
    expect(isNotFoundAnswer('NOT_FOUND')).toBe(true)
  })

  it('matches with surrounding whitespace', () => {
    expect(isNotFoundAnswer('  NOT_FOUND\n')).toBe(true)
  })

  it('does not match a real answer that happens to mention the word', () => {
    expect(isNotFoundAnswer('The document states the value is NOT_FOUND anywhere else.')).toBe(false)
  })

  it('does not match a normal answer', () => {
    expect(isNotFoundAnswer('The governing law is Kuwait [1].')).toBe(false)
  })
})

describe('extractCitationOrdinals', () => {
  it('extracts citation numbers in first-seen order', () => {
    expect(extractCitationOrdinals('See [3] and [1], also [3] again.')).toEqual([3, 1])
  })

  it('returns an empty array when there are no citations', () => {
    expect(extractCitationOrdinals('No citations here.')).toEqual([])
  })

  it('deduplicates repeated citations', () => {
    expect(extractCitationOrdinals('[2] [2] [2]')).toEqual([2])
  })
})

describe('resolveCitations', () => {
  const matches = [
    { id: 'clause-a', clauseNumber: '1' },
    { id: 'clause-b', clauseNumber: '2' },
    { id: 'clause-c', clauseNumber: null },
  ]

  it('maps every cited ordinal to the retrieved clause it actually refers to', () => {
    expect(resolveCitations('Fees are due in 30 days [2]. Liability is capped [1].', matches)).toEqual([
      { ordinal: 2, clauseId: 'clause-b', clauseNumber: '2' },
      { ordinal: 1, clauseId: 'clause-a', clauseNumber: '1' },
    ])
  })

  it('handles a clause with no document clause_number (retrieval-only ordinal)', () => {
    expect(resolveCitations('See [3].', matches)).toEqual([{ ordinal: 3, clauseId: 'clause-c', clauseNumber: null }])
  })

  it('drops a wrong/hallucinated citation outside the retrieved range so it can never be persisted', () => {
    // The model's answer text is otherwise correct, but [7] does not correspond to any of the
    // 3 clauses actually retrieved for this question -- a wrong or invented citation. The system
    // must silently drop it rather than insert a citations row pointing nowhere valid.
    expect(resolveCitations('The term is twelve months [7].', matches)).toEqual([])
  })

  it('drops only the invalid ordinal in a mix of valid and wrong citations', () => {
    expect(resolveCitations('Confirmed by [1] and also [99].', matches)).toEqual([
      { ordinal: 1, clauseId: 'clause-a', clauseNumber: '1' },
    ])
  })

  it('drops ordinal 0 and negative-looking ordinals', () => {
    expect(resolveCitations('See [0].', matches)).toEqual([])
  })

  it('returns an empty array when the answer cites nothing', () => {
    expect(resolveCitations('No supporting clause for this.', matches)).toEqual([])
  })

  it('deduplicates a repeated valid citation into a single resolved row', () => {
    expect(resolveCitations('[1] and again [1].', matches)).toEqual([
      { ordinal: 1, clauseId: 'clause-a', clauseNumber: '1' },
    ])
  })
})
