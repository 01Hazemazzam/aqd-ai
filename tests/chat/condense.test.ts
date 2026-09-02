// tests/chat/condense.test.ts
//
// The decision of WHETHER to rewrite a follow-up is where this can go wrong
// in both directions: rewriting a clear question wastes a model call and can
// distort it, while not rewriting "and for the provider?" guarantees a bad
// retrieval. These pin both edges, in English and Arabic.
import { describe, it, expect } from 'vitest'
import { needsHistoryContext, recentTurns, acceptCondensed, HISTORY_TURNS, type ConversationTurn } from '@/lib/chat/condense'

const HISTORY: ConversationTurn[] = [
  { role: 'user', content: 'What is the termination notice period?' },
  { role: 'assistant', content: 'The customer may terminate on sixty (60) days written notice [1].' },
]

describe('needsHistoryContext', () => {
  it('never rewrites the first question in a conversation', () => {
    expect(needsHistoryContext('What is the termination notice period?', [])).toBe(false)
  })

  it('rewrites a follow-up that stands in for something said earlier', () => {
    expect(needsHistoryContext('Does that apply to the provider as well?', HISTORY)).toBe(true)
    expect(needsHistoryContext('Is it the same for confidentiality breaches?', HISTORY)).toBe(true)
  })

  it('rewrites a follow-up that opens as a continuation', () => {
    expect(needsHistoryContext('And what happens after the initial term expires?', HISTORY)).toBe(true)
    expect(needsHistoryContext('What about the provider side of the agreement?', HISTORY)).toBe(true)
  })

  it('rewrites a question too short to carry its own subject', () => {
    // "In Arabic?" names nothing; only the conversation says what it means.
    expect(needsHistoryContext('In Arabic?', HISTORY)).toBe(true)
    expect(needsHistoryContext('And the customer?', HISTORY)).toBe(true)
  })

  it('leaves a self-contained question alone even mid-conversation', () => {
    // Rewriting this costs a model call and risks distorting a question that
    // was already answerable as asked.
    expect(needsHistoryContext('Which law governs disputes under this agreement?', HISTORY)).toBe(false)
    expect(needsHistoryContext('List every payment deadline stated in the contract.', HISTORY)).toBe(false)
  })

  it('handles Arabic follow-ups and standalone questions alike', () => {
    expect(needsHistoryContext('وماذا عن المورّد في نفس الحالة؟', HISTORY)).toBe(true)
    expect(needsHistoryContext('هل ينطبق هذا البند على الطرف الآخر أيضًا؟', HISTORY)).toBe(true)
    expect(needsHistoryContext('ما هو القانون الحاكم لتسوية النزاعات بين الطرفين؟', HISTORY)).toBe(false)
  })

  it('treats an empty question as nothing to rewrite', () => {
    expect(needsHistoryContext('   ', HISTORY)).toBe(false)
  })

  // Regression: "this"/"the" in front of a document noun points at the
  // contract the whole conversation is about, not at anything said earlier.
  // Reading it as a back-reference sent every such question through a
  // needless rewrite.
  it('does not treat a reference to the contract itself as a back-reference', () => {
    expect(needsHistoryContext('Which law governs disputes under this agreement?', HISTORY)).toBe(false)
    expect(needsHistoryContext('Does the contract state a cap on aggregate liability?', HISTORY)).toBe(false)
    expect(needsHistoryContext('هل تنص هذه الاتفاقية على حد أقصى للمسؤولية الإجمالية؟', HISTORY)).toBe(false)
  })

  // Regression: \b is defined over ASCII word characters, so an Arabic
  // pattern ending in \b never matched and Arabic follow-ups were silently
  // never rewritten. Separately, "هو" was listed as a pronoun -- it opens the
  // ordinary interrogative "ما هو" ("what is"), so it fired on every
  // standalone Arabic question instead.
  it('detects an Arabic follow-up without firing on an ordinary Arabic interrogative', () => {
    expect(needsHistoryContext('وماذا عن الطرف الآخر في الحالة ذاتها تمامًا؟', HISTORY)).toBe(true)
    expect(needsHistoryContext('ما هو الحد الأقصى للمسؤولية المنصوص عليه هنا؟', HISTORY)).toBe(false)
  })
})

describe('recentTurns', () => {
  it('keeps only the most recent turns, oldest first', () => {
    const long: ConversationTurn[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i}`,
    }))
    const kept = recentTurns(long)
    expect(kept).toHaveLength(HISTORY_TURNS)
    expect(kept[0].content).toBe(`turn ${10 - HISTORY_TURNS}`)
    expect(kept.at(-1)?.content).toBe('turn 9')
  })

  it('returns a short conversation whole', () => {
    expect(recentTurns(HISTORY)).toEqual(HISTORY)
  })
})

describe('acceptCondensed', () => {
  const original = 'And for the provider?'

  it('takes a usable rewrite', () => {
    expect(acceptCondensed('Does the termination notice period apply to the provider?', original)).toBe(
      'Does the termination notice period apply to the provider?',
    )
  })

  it('strips quotes a model wrapped around its answer', () => {
    expect(acceptCondensed('"Does the notice period apply to the provider?"', original)).toBe(
      'Does the notice period apply to the provider?',
    )
  })

  it('falls back to the user’s own words when the rewrite is empty', () => {
    expect(acceptCondensed('', original)).toBe(original)
    expect(acceptCondensed('   \n ', original)).toBe(original)
  })

  it('falls back when the model answered instead of rewriting', () => {
    // A model that starts explaining has produced prose, not a search query;
    // embedding a paragraph retrieves worse than embedding the question.
    const essay = 'Certainly! '.repeat(60)
    expect(acceptCondensed(essay, original)).toBe(original)
  })

  it('falls back when the rewrite collapsed to a single word', () => {
    expect(acceptCondensed('Provider', original)).toBe(original)
  })
})
