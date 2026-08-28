// tests/ingest/segment.test.ts
import { describe, it, expect } from 'vitest'
import { segmentClauses } from '@/lib/ingest/segment'

describe('segmentClauses', () => {
  it('splits English numbered clauses and tags them en', () => {
    const clauses = segmentClauses(
      '1. Definitions\nThis agreement means this document.\n\n2. Term\nThis agreement lasts one year.'
    )
    expect(clauses).toHaveLength(2)
    expect(clauses[0]).toMatchObject({ ordinal: 1, clauseNumber: '1', lang: 'en' })
    expect(clauses[0].body).toContain('Definitions')
    expect(clauses[1]).toMatchObject({ ordinal: 2, clauseNumber: '2', lang: 'en' })
  })

  it('splits Arabic-numbered "المادة" clauses and tags them ar', () => {
    const clauses = segmentClauses('المادة 1: التعريفات\nيقصد بهذه الاتفاقية هذه الوثيقة.\n\nالمادة 2: المدة\nتستمر هذه الاتفاقية سنة واحدة.')
    expect(clauses).toHaveLength(2)
    expect(clauses[0]).toMatchObject({ ordinal: 1, clauseNumber: '1', lang: 'ar' })
    expect(clauses[1]).toMatchObject({ ordinal: 2, clauseNumber: '2', lang: 'ar' })
  })

  it('tags an English clause inside an otherwise Arabic contract as en', () => {
    const clauses = segmentClauses(
      'المادة 1: التعريفات\nيقصد بهذه الاتفاقية هذه الوثيقة.\n\nArticle 2: Governing Law\nThis agreement is governed by the laws of Kuwait.'
    )
    expect(clauses).toHaveLength(2)
    expect(clauses[0].lang).toBe('ar')
    expect(clauses[1].lang).toBe('en')
    expect(clauses[1].clauseNumber).toBe('2')
  })

  it('recognizes "Article N" and "Section N" headings', () => {
    const clauses = segmentClauses('Article 1: Scope\nThe scope is broad.\n\nSection 2: Payment\nPayment is due monthly.')
    expect(clauses.map((c) => c.clauseNumber)).toEqual(['1', '2'])
  })

  it('falls back to paragraph splitting when no clause numbering exists', () => {
    const clauses = segmentClauses('This is the first paragraph of a plain letter.\n\nThis is the second paragraph.')
    expect(clauses).toHaveLength(2)
    expect(clauses[0].clauseNumber).toBeNull()
    expect(clauses[1].clauseNumber).toBeNull()
  })

  it('assigns sequential ordinals starting at 1', () => {
    const clauses = segmentClauses('1. First\nBody one.\n\n2. Second\nBody two.\n\n3. Third\nBody three.')
    expect(clauses.map((c) => c.ordinal)).toEqual([1, 2, 3])
  })

  it('drops a trailing heading with no body instead of returning a blank clause', () => {
    const clauses = segmentClauses('1. Only clause\nSome text.\n\n2. \n')
    expect(clauses).toHaveLength(1)
    expect(clauses.every((c) => c.body.length > 0)).toBe(true)
  })
})
