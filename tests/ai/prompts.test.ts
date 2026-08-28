// tests/ai/prompts.test.ts
import { describe, it, expect } from 'vitest'
import { extractJson, MalformedAiResponseError, summaryPrompt, fieldsPrompt, risksPrompt, obligationsPrompt } from '@/lib/ai/prompts'

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
