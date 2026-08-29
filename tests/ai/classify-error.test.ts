// tests/ai/classify-error.test.ts
//
// Root-cause coverage for the user-reported "analysis pipeline is broken":
// all four analysis tasks are hardcoded to the 'main' tier (analyze-
// actions.ts), and analyzeContract collapsed every non-disabled failure into
// one generic 'unknown' error, indistinguishable in the UI from a real bug.
// A real, reproduced 429 (Gemini's free-tier daily quota, confirmed live via
// a direct request with the actual key -- see README's Sub-project 5
// section) rendered as "Something went wrong. Please try again." with no
// way to tell it apart from an actual defect. This covers the fix: the real
// HTTP status now survives from router.ts's AiUpstreamError, through
// mapTaskError, to classifyAnalysisError's final classification.
import { describe, it, expect } from 'vitest'
import { AiDisabledError, AiUpstreamError } from '@/lib/ai/router'
import { mapTaskError, classifyAnalysisError } from '@/lib/ai/classify-error'

describe('mapTaskError', () => {
  it('maps a real Gemini 429 quota error to upstreamStatus 429, not disabled', () => {
    const err = new AiUpstreamError('Gemini 429: {"error":{"status":"RESOURCE_EXHAUSTED"}}', true, 429)
    expect(mapTaskError(err)).toEqual({ disabled: false, upstreamStatus: 429 })
  })

  it('maps a missing API key to disabled, with no upstream status', () => {
    const err = new AiDisabledError('No API key configured for provider "gemini"')
    expect(mapTaskError(err)).toEqual({ disabled: true, upstreamStatus: undefined })
  })

  it('maps a non-retryable, non-quota upstream error (e.g. content blocked) to neither', () => {
    const err = new AiUpstreamError('Gemini blocked the prompt: SAFETY', false)
    expect(mapTaskError(err)).toEqual({ disabled: false, upstreamStatus: undefined })
  })
})

describe('classifyAnalysisError', () => {
  it('reports ai_disabled when any task was disabled, even if others carry a different status', () => {
    expect(classifyAnalysisError([{ disabled: true }, { upstreamStatus: 500 }])).toBe('ai_disabled')
  })

  it('reports quota_exceeded when a task failed with HTTP 429 and none were disabled', () => {
    expect(classifyAnalysisError([{ upstreamStatus: 500 }, { upstreamStatus: 429 }])).toBe('quota_exceeded')
  })

  it('falls back to unknown for anything else', () => {
    expect(classifyAnalysisError([{ upstreamStatus: 500 }, {}])).toBe('unknown')
  })
})
