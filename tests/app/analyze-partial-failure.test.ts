// tests/app/analyze-partial-failure.test.ts
//
// P1 fix: a partially-failed analysis (some tasks succeed, some don't)
// previously saved as a plain 'ready' analysis with zero visible signal that
// anything went wrong -- the failed task's section just silently didn't
// appear. This proves the persisted row now carries error: 'partial' when
// exactly one of the four tasks fails, and error: null when all four
// succeed, using the actual production analyzeContract function against a
// mocked Supabase client shaped like the real schema.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/org/current', () => ({ getCurrentOrgId: async () => 'org-1' }))
vi.mock('@/lib/ai/prompts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/prompts')>('@/lib/ai/prompts')
  return {
    ...actual,
    summaryPrompt: () => ({ system: 'TASK:summary', user: '' }),
    fieldsPrompt: () => ({ system: 'TASK:fields', user: '' }),
    risksPrompt: () => ({ system: 'TASK:risks', user: '' }),
    obligationsPrompt: () => ({ system: 'TASK:obligations', user: '' }),
  }
})

const aiComplete = vi.fn()
vi.mock('@/lib/ai/router', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/router')>('@/lib/ai/router')
  return { ...actual, aiComplete }
})

const analysesUpdate = vi.fn()

function makeSupabase() {
  return {
    from: (table: string) => {
      if (table === 'contract_versions') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'version-1' } }) }) }) }) }) }
      }
      if (table === 'clauses') {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'clause-1', clause_number: '1', body: 'Body text' }] }) }) }) }
      }
      if (table === 'analyses') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'analysis-1' } }) }) }),
          update: (payload: unknown) => {
            analysesUpdate(payload)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      if (table === 'playbook_rules') {
        return { select: async () => ({ data: [] }) }
      }
      if (table === 'usage_events') {
        return { insert: async () => ({ error: null }) }
      }
      if (table === 'risk_findings') {
        return { delete: () => ({ eq: async () => ({ error: null }) }), insert: async () => ({ error: null }) }
      }
      return {}
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => makeSupabase() }))

beforeEach(() => {
  aiComplete.mockReset()
  analysesUpdate.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function jsonResult(payload: unknown) {
  return { text: JSON.stringify(payload), model: 'test-model', inputTokens: 1, outputTokens: 1, costUsd: 0 }
}

describe('analyzeContract partial-failure surfacing', () => {
  it('persists error: "partial" when exactly one of four tasks fails', async () => {
    aiComplete.mockImplementation(async (_tier: string, system: string) => {
      if (system === 'TASK:fields') throw new Error('malformed response')
      if (system === 'TASK:summary') return jsonResult({ summary: 'A summary.' })
      if (system === 'TASK:risks') return jsonResult({ findings: [] })
      if (system === 'TASK:obligations') return jsonResult({ obligations: [] })
      throw new Error('unexpected task')
    })

    const { analyzeContract } = await import('@/app/(app)/contracts/[id]/analyze-actions')
    const result = await analyzeContract('contract-1')

    expect(result).toEqual({ analysisId: 'analysis-1', cached: false })
    const finalUpdate = analysesUpdate.mock.calls.find((c) => c[0].status === 'ready')
    expect(finalUpdate?.[0].error).toBe('partial')
    expect(finalUpdate?.[0].summary).toBe('A summary.')
    expect(finalUpdate?.[0].fields).toBeNull()
  })

  it('persists error: null when all four tasks succeed', async () => {
    aiComplete.mockImplementation(async (_tier: string, system: string) => {
      if (system === 'TASK:summary') return jsonResult({ summary: 'A summary.' })
      if (system === 'TASK:fields') return jsonResult({ parties: null, effectiveDate: null, termLength: null, governingLaw: null, totalValue: null })
      if (system === 'TASK:risks') return jsonResult({ findings: [] })
      if (system === 'TASK:obligations') return jsonResult({ obligations: [] })
      throw new Error('unexpected task')
    })

    const { analyzeContract } = await import('@/app/(app)/contracts/[id]/analyze-actions')
    await analyzeContract('contract-1')

    const finalUpdate = analysesUpdate.mock.calls.find((c) => c[0].status === 'ready')
    expect(finalUpdate?.[0].error).toBeNull()
  })
})
