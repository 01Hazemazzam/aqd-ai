// tests/ai/prompts.test.ts
import { describe, it, expect } from 'vitest'
import { extractJson, MalformedAiResponseError, summaryPrompt, risksPrompt } from '@/lib/ai/prompts'

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
})

describe('prompt builders', () => {
  it('embeds each clause id and body in the rendered user prompt', () => {
    const { user } = summaryPrompt([{ id: 'abc-123', clauseNumber: '1', body: 'Definitions clause.' }])
    expect(user).toContain('abc-123')
    expect(user).toContain('Definitions clause.')
  })

  it('embeds the playbook rule list in the risks system prompt', () => {
    const { system } = risksPrompt(
      [{ id: 'c1', clauseNumber: '1', body: 'text' }],
      [{ ruleKey: 'termination_clause', title: 'Termination rights', description: 'desc', severityHint: 'high' }],
    )
    expect(system).toContain('termination_clause')
    expect(system).toContain('Termination rights')
  })
})
