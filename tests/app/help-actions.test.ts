// tests/app/help-actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/guards', () => ({ requireVerified: vi.fn().mockResolvedValue({ id: 'user-1' }) }))

const aiComplete = vi.fn()
vi.mock('@/lib/ai/router', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/router')>('@/lib/ai/router')
  return { ...actual, aiComplete }
})

beforeEach(() => {
  aiComplete.mockReset()
})

describe('askProductHelper', () => {
  it('returns the model answer on success, using the cheap tier', async () => {
    aiComplete.mockResolvedValue({ text: '  You can invite teammates from Settings > Team.  ', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 0 })
    const { askProductHelper } = await import('@/app/(app)/help/actions')

    const result = await askProductHelper('How do I invite a teammate?')

    expect(result).toEqual({ answer: 'You can invite teammates from Settings > Team.', error: null })
    expect(aiComplete).toHaveBeenCalledWith('cheap', expect.any(String), 'How do I invite a teammate?')
  })

  it('classifies a real 429 as quota_exceeded, same as analysis and chat', async () => {
    const { AiUpstreamError } = await import('@/lib/ai/router')
    aiComplete.mockRejectedValue(new AiUpstreamError('Gemini 429: quota', true, 429))
    const { askProductHelper } = await import('@/app/(app)/help/actions')

    expect(await askProductHelper('How does risk scoring work?')).toEqual({ answer: null, error: 'quota_exceeded' })
  })

  it('classifies a missing API key as ai_disabled', async () => {
    const { AiDisabledError } = await import('@/lib/ai/router')
    aiComplete.mockRejectedValue(new AiDisabledError('No API key configured for provider "gemini"'))
    const { askProductHelper } = await import('@/app/(app)/help/actions')

    expect(await askProductHelper('How does risk scoring work?')).toEqual({ answer: null, error: 'ai_disabled' })
  })

  it('returns nothing for a blank question without calling the model', async () => {
    const { askProductHelper } = await import('@/app/(app)/help/actions')
    expect(await askProductHelper('   ')).toEqual({ answer: null, error: null })
    expect(aiComplete).not.toHaveBeenCalled()
  })
})
