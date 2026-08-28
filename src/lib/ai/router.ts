export type Tier = 'cheap' | 'main' | 'heavy'
export type Provider = 'anthropic' | 'gemini'

export class AiDisabledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiDisabledError'
  }
}

// retryable=false marks a failure retrying can't fix (bad request, content
// blocked, truncated JSON) so the caller doesn't burn attempts on it.
export class AiUpstreamError extends Error {
  retryable: boolean
  constructor(message: string, retryable = true) {
    super(message)
    this.name = 'AiUpstreamError'
    this.retryable = retryable
  }
}

interface ModelSpec {
  provider: Provider
  model: string
  inputPricePerMTok: number
  outputPricePerMTok: number
}

// Defaults are env-overridable so the QA-harness style workflow (point the
// same production code at a different model/proxy) works without a code
// change. Prices are USD per million tokens, used only for the usage_events
// cost estimate -- not billing-accurate, directional.
const TIERS: Record<Tier, ModelSpec> = {
  cheap: {
    provider: 'gemini',
    model: process.env.AI_MODEL_CHEAP ?? 'gemini-2.5-flash-lite',
    inputPricePerMTok: 0.1,
    outputPricePerMTok: 0.4,
  },
  main: {
    provider: 'gemini',
    model: process.env.AI_MODEL_MAIN ?? 'gemini-2.5-flash',
    inputPricePerMTok: 0.3,
    outputPricePerMTok: 2.5,
  },
  heavy: {
    provider: 'anthropic',
    model: process.env.AI_MODEL_HEAVY ?? 'claude-sonnet-4-5',
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
  },
}

export interface AiCallResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

function apiKeyFor(provider: Provider): string | undefined {
  return provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY
}

function estimateCost(spec: ModelSpec, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * spec.inputPricePerMTok + (outputTokens / 1_000_000) * spec.outputPricePerMTok
}

export async function callAnthropic(
  spec: ModelSpec,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
): Promise<AiCallResult> {
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: spec.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    throw new AiUpstreamError(`Anthropic ${response.status}: ${await response.text()}`, retryable)
  }

  const body = await response.json()
  if (body.stop_reason === 'max_tokens') {
    throw new AiUpstreamError('Anthropic response truncated at max_tokens', false)
  }
  const text = (body.content ?? []).map((block: { text?: string }) => block.text ?? '').join('')
  if (!text) throw new AiUpstreamError('Anthropic returned no text content', false)

  return {
    text,
    model: spec.model,
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    costUsd: estimateCost(spec, body.usage?.input_tokens ?? 0, body.usage?.output_tokens ?? 0),
  }
}

export async function callGemini(
  spec: ModelSpec,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
): Promise<AiCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:generateContent`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    }),
  })

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    throw new AiUpstreamError(`Gemini ${response.status}: ${await response.text()}`, retryable)
  }

  const body = await response.json()

  // Gemini's equivalent of a "200 that isn't actually a completion": a
  // safety block returns 200 with no candidates at all, and truncation
  // shows up as finishReason instead of an HTTP error.
  if (body.promptFeedback?.blockReason) {
    throw new AiUpstreamError(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`, false)
  }
  const candidate = body.candidates?.[0]
  if (!candidate) throw new AiUpstreamError('Gemini returned no candidates', false)
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new AiUpstreamError('Gemini response truncated at MAX_TOKENS', false)
  }

  const text = (candidate.content?.parts ?? []).map((part: { text?: string }) => part.text ?? '').join('')
  if (!text) throw new AiUpstreamError('Gemini returned no text content', false)

  const usage = body.usageMetadata ?? {}
  return {
    text,
    model: spec.model,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    costUsd: estimateCost(spec, usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function aiComplete(
  tier: Tier,
  systemPrompt: string,
  userPrompt: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<AiCallResult> {
  const spec = TIERS[tier]
  const apiKey = apiKeyFor(spec.provider)
  if (!apiKey) throw new AiDisabledError(`No API key configured for provider "${spec.provider}"`)

  const fetchImpl = opts?.fetchImpl ?? fetch
  const attempts = Number(process.env.AI_RETRY_ATTEMPTS ?? 4)
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return spec.provider === 'anthropic'
        ? await callAnthropic(spec, apiKey, systemPrompt, userPrompt, fetchImpl)
        : await callGemini(spec, apiKey, systemPrompt, userPrompt, fetchImpl)
    } catch (err) {
      lastError = err
      const retryable = err instanceof AiUpstreamError && err.retryable
      if (!retryable || attempt === attempts - 1) throw err
      await sleep(2 ** attempt * 1000)
    }
  }
  throw lastError
}
