'use server'
import { aiComplete } from '@/lib/ai/router'
import { productHelperPrompt } from '@/lib/ai/prompts'
import { mapTaskError, classifyAnalysisError } from '@/lib/ai/classify-error'
import { requireVerified } from '@/lib/auth/guards'

// 'cheap' tier deliberately -- a product-FAQ answer doesn't need the
// stronger model, and it keeps this brand-new surface off the same daily
// quota the contract analysis/chat features already have to share.
export async function askProductHelper(question: string) {
  await requireVerified()
  const trimmed = question.trim()
  if (!trimmed) return { answer: null, error: null }

  const prompt = productHelperPrompt(trimmed)
  try {
    const result = await aiComplete('cheap', prompt.system, prompt.user)
    return { answer: result.text.trim(), error: null }
  } catch (err) {
    return { answer: null, error: classifyAnalysisError([mapTaskError(err)]) }
  }
}
