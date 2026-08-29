// tests/chat/build-history.test.ts
//
// Real gap, first found live in Sub-project 4's third QA pass (see
// qa/FINDINGS.md) and left open at the time: reloading a contract page with
// existing chat history showed an empty panel -- the messages and citations
// were fully intact in the database, but ChatPanel had no fetch-on-mount.
// Fixed by having the contract page fetch history server-side and pass it
// in; this covers the mapping that fix depends on, in particular that a
// not_found row renders the translated refusal text, not the literal
// "NOT_FOUND" sentinel chat/route.ts persists to the database.
import { describe, it, expect } from 'vitest'
import { buildChatHistory } from '@/lib/chat/build-history'

describe('buildChatHistory', () => {
  it('renders the translated NOT_FOUND text instead of the literal persisted sentinel', () => {
    const result = buildChatHistory(
      [{ id: 'm1', role: 'assistant', content: 'NOT_FOUND', not_found: true }],
      [],
      new Map(),
      "This isn't stated in the contract.",
    )
    expect(result).toEqual([
      { role: 'assistant', content: "This isn't stated in the contract.", notFound: true, citations: [] },
    ])
  })

  it('attaches citations to the right message, with clause numbers resolved', () => {
    const result = buildChatHistory(
      [
        { id: 'q1', role: 'user', content: 'What is the liability cap?', not_found: false },
        { id: 'a1', role: 'assistant', content: 'Liability is capped [1].', not_found: false },
      ],
      [{ message_id: 'a1', ordinal: 1, clause_id: 'clause-18' }],
      new Map([['clause-18', '18']]),
      'not found',
    )
    expect(result[0].citations).toEqual([])
    expect(result[1].citations).toEqual([{ ordinal: 1, clauseId: 'clause-18', clauseNumber: '18' }])
    expect(result[1].content).toBe('Liability is capped [1].')
  })

  it('leaves a question with no persisted reply (a failed request) with no citations, real content intact', () => {
    const result = buildChatHistory(
      [{ id: 'q1', role: 'user', content: 'How much liability does the Provider have?', not_found: false }],
      [],
      new Map(),
      'not found',
    )
    expect(result).toEqual([
      { role: 'user', content: 'How much liability does the Provider have?', notFound: false, citations: [] },
    ])
  })

  it('resolves a citation to a null clause number gracefully rather than throwing', () => {
    const result = buildChatHistory(
      [{ id: 'a1', role: 'assistant', content: 'See [1].', not_found: false }],
      [{ message_id: 'a1', ordinal: 1, clause_id: 'clause-unknown' }],
      new Map(),
      'not found',
    )
    expect(result[0].citations).toEqual([{ ordinal: 1, clauseId: 'clause-unknown', clauseNumber: null }])
  })
})
