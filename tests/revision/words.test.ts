// tests/revision/words.test.ts
//
// The diff is what turns "clause 7 was modified" into something a reader can
// act on in a second. Its contract is stricter than it looks: dropping the
// added segments has to reproduce the old clause exactly, and dropping the
// removed ones the new clause -- that round trip is what lets one rendering
// stand in for two documents.
import { describe, it, expect } from 'vitest'
import { diffWords, type DiffSegment } from '@/lib/revision/words'

const render = (segments: DiffSegment[], side: 'before' | 'after') =>
  segments
    .filter((s) => s.kind === 'equal' || s.kind === (side === 'before' ? 'removed' : 'added'))
    .map((s) => s.text)
    .join(' ')

const words = (segments: DiffSegment[], kind: DiffSegment['kind']) =>
  segments.filter((s) => s.kind === kind).map((s) => s.text)

describe('diffWords :: the edit a reader is looking for', () => {
  it('marks a changed number and leaves the sentence around it alone', () => {
    const segments = diffWords(
      'Either party may terminate on sixty (60) days written notice.',
      'Either party may terminate on thirty (30) days written notice.',
    )

    expect(words(segments, 'removed')).toEqual(['sixty (60)'])
    expect(words(segments, 'added')).toEqual(['thirty (30)'])
  })

  // Punctuation travels with the word it is attached to, so the full stop
  // that became a comma is reported as an edit to that word. Splitting it off
  // would read better here and lie elsewhere: in a contract, "shall not" and
  // "shall, not" are different, and a period ending a sentence is the
  // difference between one obligation and two.
  it('marks an inserted carve-out as an addition', () => {
    const segments = diffWords(
      'The Provider shall indemnify the Customer against all claims.',
      'The Provider shall indemnify the Customer against all claims, except claims arising from the Customer’s own negligence.',
    )

    expect(words(segments, 'removed')).toEqual(['claims.'])
    expect(words(segments, 'added')).toEqual(['claims, except claims arising from the Customer’s own negligence.'])
  })

  it('marks a deleted obligation as a removal', () => {
    const segments = diffWords(
      'The Provider shall notify the Customer promptly and shall remedy the breach within ten days.',
      'The Provider shall notify the Customer promptly.',
    )

    expect(words(segments, 'removed')).toEqual(['promptly and shall remedy the breach within ten days.'])
    expect(words(segments, 'added')).toEqual(['promptly.'])
    expect(segments[0]).toEqual({ kind: 'equal', text: 'The Provider shall notify the Customer' })
  })

  // The word that flips a duty into a discretion is one token long and sits
  // in the middle of an otherwise untouched paragraph.
  it('finds a one-word change inside long unchanged text', () => {
    const before = `The Provider shall ${'maintain the Services in accordance with the Service Levels set out in Schedule B '.repeat(6)} and shall report monthly.`
    const after = before.replace('The Provider shall', 'The Provider may')

    const segments = diffWords(before, after)

    expect(words(segments, 'removed')).toEqual(['shall'])
    expect(words(segments, 'added')).toEqual(['may'])
  })
})

describe('diffWords :: the round trip both sides depend on', () => {
  const cases: Array<[string, string]> = [
    ['The cap is twelve months of fees.', 'The cap is three months of fees.'],
    ['One two three four five', 'five four three two one'],
    ['', 'A wholly new clause.'],
    ['A deleted clause.', ''],
    ['identical text', 'identical text'],
    ['يجوز لأي من الطرفين الإنهاء بإشعار ستين يوماً', 'يجوز لأي من الطرفين الإنهاء بإشعار تسعين يوماً'],
  ]

  it.each(cases)('reproduces both documents from one segment run (%#)', (before, after) => {
    const segments = diffWords(before, after)

    expect(render(segments, 'before')).toBe(before.trim().replace(/\s+/g, ' '))
    expect(render(segments, 'after')).toBe(after.trim().replace(/\s+/g, ' '))
  })

  it('reports an unchanged clause as a single equal run', () => {
    const segments = diffWords('The Agreement is governed by the laws of Kuwait.', 'The Agreement is governed by the laws of Kuwait.')

    expect(segments).toEqual([{ kind: 'equal', text: 'The Agreement is governed by the laws of Kuwait.' }])
  })

  it('marks Arabic edits in the same shape as English ones', () => {
    const segments = diffWords(
      'يلتزم المزود بتقديم الخدمات خلال ثلاثين يوماً',
      'يلتزم المزود بتقديم الخدمات خلال ستين يوماً',
    )

    expect(words(segments, 'removed')).toEqual(['ثلاثين'])
    expect(words(segments, 'added')).toEqual(['ستين'])
  })
})

describe('diffWords :: a rewrite is not an edit', () => {
  // Two clauses with nothing in common produce a word-level diff that is pure
  // noise -- alternating fragments the reader has to reassemble. Past the
  // size where the table is worth building, the honest rendering is "all of
  // this became all of that".
  it('falls back to whole-clause replacement rather than shredding a rewrite', () => {
    const before = Array.from({ length: 800 }, (_, i) => `alpha${i}`).join(' ')
    const after = Array.from({ length: 800 }, (_, i) => `beta${i}`).join(' ')

    const segments = diffWords(before, after)

    expect(segments).toHaveLength(2)
    expect(segments[0].kind).toBe('removed')
    expect(segments[1].kind).toBe('added')
  })
})
