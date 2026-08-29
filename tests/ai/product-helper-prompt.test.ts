// tests/ai/product-helper-prompt.test.ts
//
// Sub-project 5's exit test: "the assistant answers product questions and
// cannot answer data questions." Unlike chatPrompt, productHelperPrompt is
// never given any contract/clause/analysis data at all -- there's nothing
// to citation-lock against, so the guarantee that it can't leak real data
// is architectural (askProductHelper never queries any org-scoped table).
// What still depends on the model is *recognizing* a data question and
// refusing rather than fabricating a plausible answer -- these tests check
// the prompt actually instructs that, and the live-verification pass
// (README/qa/FINDINGS.md) checks the model actually follows it.
import { describe, it, expect } from 'vitest'
import { productHelperPrompt } from '@/lib/ai/prompts'

describe('productHelperPrompt', () => {
  it('instructs refusing and redirecting data questions rather than fabricating an answer', () => {
    const { system } = productHelperPrompt('What is the liability cap in my contract?')
    expect(system).toMatch(/no access to any user's contracts/i)
    expect(system).toMatch(/refuse and redirect/i)
    expect(system).toMatch(/never guess or fabricate/i)
  })

  it('describes real Aqd features so it can actually answer product questions', () => {
    const { system } = productHelperPrompt('How do I invite a teammate?')
    expect(system).toContain('Settings > Team')
    expect(system).toContain('Analyze')
    expect(system).toContain('citations')
  })

  it('passes the question through as the user turn, unmodified', () => {
    const { user } = productHelperPrompt('How does risk scoring work?')
    expect(user).toBe('How does risk scoring work?')
  })
})
