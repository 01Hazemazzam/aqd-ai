export type Tier = 'cheap' | 'main' | 'heavy'
export type Provider = 'anthropic' | 'gemini' | 'openrouter'

export class AiDisabledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiDisabledError'
  }
}

// retryable=false marks a failure retrying can't fix (bad request, content
// blocked, truncated JSON) so the caller doesn't burn attempts on it.
// status carries the real HTTP status (when there was an HTTP response at
// all -- a blocked prompt or empty candidate has none) so a caller can tell
// "quota exhausted" (429) apart from every other failure without parsing the
// message string; analyze-actions.ts's error classification depends on this.
export class AiUpstreamError extends Error {
  retryable: boolean
  status?: number
  constructor(message: string, retryable = true, status?: number) {
    super(message)
    this.name = 'AiUpstreamError'
    this.retryable = retryable
    this.status = status
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
    // Rolling aliases, not a pinned version: gemini-2.5-flash-lite (the
    // previous default here) returned 404 "no longer available to new
    // users" during real-model validation. Google's own error message
    // recommended pinning forward again, but the alias is what actually
    // resists the same breakage next time a model generation retires.
    model: process.env.AI_MODEL_CHEAP ?? 'gemini-flash-lite-latest',
    inputPricePerMTok: 0.1,
    outputPricePerMTok: 0.4,
  },
  main: {
    provider: 'gemini',
    model: process.env.AI_MODEL_MAIN ?? 'gemini-flash-latest',
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

// Not a fourth tier a caller selects -- an automatic last-resort fallback
// used only when the requested tier's own provider fails or has no key
// configured, per explicit instruction: use Gemini/Anthropic when they're
// healthy, fall back to OpenRouter when they're not. Priced at zero
// deliberately -- this key is scoped to $0-credit free-only models
// (confirmed by its own dashboard label), so unlike the other tiers this
// estimate is exact, not directional.
//
// No stable "latest free model" alias exists on OpenRouter the way Gemini's
// "-latest" tags work -- each free model is its own specific slug, and the
// free catalog genuinely churns: the model this was first configured with
// (openai/gpt-oss-20b:free) had already been pulled from free routing by
// the time this was live-tested, confirmed directly against OpenRouter's
// /models endpoint and by testing several catalog entries live. If this
// default ever starts 404ing with "unavailable for free," that's why --
// check https://openrouter.ai/models?max_price=0 for a current one, the
// same maintenance Gemini's own model aliases have already needed once.
const OPENROUTER_FALLBACK: ModelSpec = {
  provider: 'openrouter',
  model: process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3.5-lightning:free',
  inputPricePerMTok: 0,
  outputPricePerMTok: 0,
}

export interface AiCallResult {
  text: string
  /** The provider that actually served this call -- not necessarily the tier's default (see AI_FORCE_PROVIDER / the OpenRouter fallback). */
  provider: Provider
  /** The model id requested (a rolling alias, e.g. "gemini-flash-latest"). */
  requestedModel: string
  /** What the provider actually resolved and served -- can differ from requestedModel; see the per-provider comments below. */
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

function apiKeyFor(provider: Provider): string | undefined {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY
  return process.env.GEMINI_API_KEY
}

// Explicit, developer-set override for testing a specific provider path on
// demand (e.g. proving the OpenRouter route works end-to-end without
// needing Gemini to actually be down). Only 'openrouter' is meaningful here
// -- forcing 'gemini' or 'anthropic' would just be each tier's own default.
// Unset (the normal case) leaves every tier's provider mapping untouched.
function forcedProvider(): Provider | undefined {
  const value = process.env.AI_FORCE_PROVIDER
  return value === 'openrouter' ? value : undefined
}

// Automatic fallback is the desired default (it's what actually resolves
// the Gemini free-tier quota ceiling), but a QA run validating Gemini's OWN
// behavior needs a way to see its real, unmasked failures instead of having
// them silently absorbed by a fallback answer. AI_FALLBACK_ENABLED=false is
// that explicit escape hatch; any other value (including unset) leaves the
// existing default-on behavior unchanged.
function fallbackAllowed(): boolean {
  return process.env.AI_FALLBACK_ENABLED !== 'false'
}

function estimateCost(spec: ModelSpec, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * spec.inputPricePerMTok + (outputTokens / 1_000_000) * spec.outputPricePerMTok
}

// Root cause of the "analysis takes minutes" report: none of the fetch calls
// below had any timeout at all. Under real Gemini "high demand" 503s, a
// single attempt was observed hanging 30-40s+ before finally responding --
// with 4 retry attempts compounding that, one analyzeContract call was
// measured at 154877ms and another at 175375ms (production log,
// /tmp/nextdev.log) before it ever reached the OpenRouter fallback. A timeout
// bounds each individual attempt so a stuck upstream fails fast into the next
// retry/fallback instead of hanging indefinitely. Treated as retryable (like
// a 5xx) since a client-side timeout is ambiguous -- it doesn't prove the
// upstream is permanently down the way a 429 daily-quota body does.
const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 15000)

// How many times one provider is asked before giving up on it.
//
// This is a wall-clock budget, not a resilience dial, because the whole call
// happens inside one serverless invocation with a hard ceiling (60s on the
// deployment target). The worst case has to fit under it with room for the
// database writes that follow, or a degraded-but-recoverable upstream turns
// into a killed function and a half-written analysis:
//
//   attempts x REQUEST_TIMEOUT_MS  +  backoff  +  one OpenRouter fallback call
//   2 x 15s                        +  1s       +  15s                  = 46s
//
// The previous default of 4 put that at 82s -- comfortably over the ceiling,
// and only ever reachable when everything was already going wrong. Two
// attempts still absorbs a single transient 5xx, and the fallback is a third
// bite at the request from a different provider, which is worth more than a
// fourth from the one that is failing.

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  providerLabel: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AiUpstreamError(`${providerLabel} request timed out after ${REQUEST_TIMEOUT_MS}ms`, true)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function callAnthropic(
  spec: ModelSpec,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
): Promise<AiCallResult> {
  const response = await fetchWithTimeout(fetchImpl, 'Anthropic', 'https://api.anthropic.com/v1/messages', {
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
    // 429 is deliberately NOT retryable here -- see the matching comment on
    // callGemini, the provider this app has actually hit 429s against.
    const retryable = response.status >= 500
    throw new AiUpstreamError(`Anthropic ${response.status}: ${await response.text()}`, retryable, response.status)
  }

  const body = await response.json()
  if (body.stop_reason === 'max_tokens') {
    throw new AiUpstreamError('Anthropic response truncated at max_tokens', false)
  }
  const text = (body.content ?? []).map((block: { text?: string }) => block.text ?? '').join('')
  if (!text) throw new AiUpstreamError('Anthropic returned no text content', false)

  return {
    text,
    provider: 'anthropic',
    requestedModel: spec.model,
    // Anthropic echoes back the exact snapshot it served, which can differ
    // from the alias requested (e.g. a "-latest" tag resolves to a dated
    // snapshot). Recording the resolved model, not the requested one, is
    // what makes a usage_events row tell you what actually produced a
    // result -- load-bearing for QA reproducibility now that model
    // defaults are aliases rather than pinned versions.
    model: body.model ?? spec.model,
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
  const response = await fetchWithTimeout(fetchImpl, 'Gemini', url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    }),
  })

  if (!response.ok) {
    // Every real 429 this app has ever hit (see qa/FINDINGS.md) is a hard
    // free-tier DAILY quota ("Quota exceeded ... limit: 20"), not a
    // transient per-minute limit -- confirmed by a retry immediately
    // failing with the identical 429 again. Exponential backoff (up to 15s
    // across 4 attempts) cannot fix a daily cap; it only delays reaching
    // the OpenRouter fallback (or, for embeddings, delays a failure that
    // has no fallback at all) with zero chance of the retry succeeding.
    // Treating 429 as non-retryable skips straight to whatever comes next.
    const retryable = response.status >= 500
    throw new AiUpstreamError(`Gemini ${response.status}: ${await response.text()}`, retryable, response.status)
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
    provider: 'gemini',
    requestedModel: spec.model,
    // `spec.model` here is often a rolling alias (e.g. "gemini-flash-latest");
    // `modelVersion` is what Google actually resolved it to and served. See
    // the matching comment in callAnthropic.
    model: body.modelVersion ?? spec.model,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    costUsd: estimateCost(spec, usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0),
  }
}

// OpenRouter speaks the OpenAI chat-completions shape, unlike either primary
// provider -- a system message in the `messages` array, not a separate
// field; `choices[0].message.content`; `usage.prompt_tokens`/
// `completion_tokens` instead of Gemini's `usageMetadata` or Anthropic's
// `usage.input_tokens`.
export async function callOpenRouter(
  spec: ModelSpec,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
): Promise<AiCallResult> {
  const response = await fetchWithTimeout(fetchImpl, 'OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: spec.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    // Same reasoning as callGemini: OpenRouter is itself the last-resort
    // fallback, so a 429 here has nowhere further to retry into anyway --
    // fail fast rather than spend up to 15s of backoff first.
    const retryable = response.status >= 500
    throw new AiUpstreamError(`OpenRouter ${response.status}: ${await response.text()}`, retryable, response.status)
  }

  const body = await response.json()
  const text = body.choices?.[0]?.message?.content ?? ''
  if (!text) throw new AiUpstreamError('OpenRouter returned no text content', false)

  const usage = body.usage ?? {}
  return {
    text,
    provider: 'openrouter',
    requestedModel: spec.model,
    // Echoes back which model actually served the request -- OpenRouter can
    // route a single model id to different underlying providers.
    model: body.model ?? spec.model,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    costUsd: estimateCost(spec, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Falls back to OpenRouter's free tier only when the requested tier's own
// provider ultimately fails (or has no key at all) AND OPENROUTER_API_KEY is
// configured -- with no OpenRouter key set, behavior is byte-for-byte
// identical to before this fallback existed. This is what actually resolves
// the Gemini free-tier daily quota ceiling instead of just failing loudly,
// per explicit instruction: prefer Gemini/Anthropic while they're healthy,
// fall back only when they're not.
async function openRouterFallback(
  provider: Provider,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
): Promise<AiCallResult | null> {
  if (!fallbackAllowed()) return null
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (!openRouterKey) return null
  try {
    const result = await callOpenRouter(OPENROUTER_FALLBACK, openRouterKey, systemPrompt, userPrompt, fetchImpl)
    console.info(`[aiComplete] provider "${provider}" unavailable, OpenRouter fallback served the request`)
    return result
  } catch (fallbackErr) {
    console.error('[aiComplete] OpenRouter fallback also failed:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr)
    return null
  }
}

export async function aiComplete(
  tier: Tier,
  systemPrompt: string,
  userPrompt: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<AiCallResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch

  // AI_FORCE_PROVIDER=openrouter -- explicit developer override, not the
  // fallback path (fallbackAllowed() intentionally does not gate this: an
  // explicit force is a deliberate choice, not an implicit silent switch).
  if (forcedProvider() === 'openrouter') {
    const openRouterKey = process.env.OPENROUTER_API_KEY
    if (!openRouterKey) throw new AiDisabledError('AI_FORCE_PROVIDER=openrouter but OPENROUTER_API_KEY is not set')
    return callOpenRouter(OPENROUTER_FALLBACK, openRouterKey, systemPrompt, userPrompt, fetchImpl)
  }

  const spec = TIERS[tier]
  const apiKey = apiKeyFor(spec.provider)

  if (!apiKey) {
    const fallback = await openRouterFallback(spec.provider, systemPrompt, userPrompt, fetchImpl)
    if (fallback) return fallback
    throw new AiDisabledError(`No API key configured for provider "${spec.provider}"`)
  }

  const attempts = Number(process.env.AI_RETRY_ATTEMPTS ?? 2)
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return spec.provider === 'anthropic'
        ? await callAnthropic(spec, apiKey, systemPrompt, userPrompt, fetchImpl)
        : await callGemini(spec, apiKey, systemPrompt, userPrompt, fetchImpl)
    } catch (err) {
      lastError = err
      const retryable = err instanceof AiUpstreamError && err.retryable
      if (!retryable || attempt === attempts - 1) break
      await sleep(2 ** attempt * 1000)
    }
  }

  const fallback = await openRouterFallback(spec.provider, systemPrompt, userPrompt, fetchImpl)
  if (fallback) return fallback
  throw lastError
}

export interface StreamChunk {
  textDelta: string
}

// Retries only the initial request -- once a response starts streaming, a
// partial answer may already be on its way to the client, so a mid-stream
// failure is not retried here; it surfaces as-is to the caller, same as
// before this retry loop existed.
async function fetchStreamWithRetry(
  url: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const attempts = Number(process.env.AI_RETRY_ATTEMPTS ?? 2)
  let lastError: AiUpstreamError | undefined

  for (let attempt = 0; attempt < attempts; attempt++) {
    let err: AiUpstreamError
    try {
      const response = await fetchWithTimeout(fetchImpl, 'Gemini', url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        }),
      })
      if (response.ok && response.body) return response

      // See callGemini's comment: a 429 here is the same hard daily quota,
      // not worth retrying.
      const retryable = response.status >= 500
      err = new AiUpstreamError(`Gemini stream ${response.status}: ${await response.text()}`, retryable, response.status)
    } catch (caught) {
      // fetchWithTimeout's own AbortError -> AiUpstreamError conversion (a
      // client-side timeout) lands here too, treated the same as a 5xx.
      if (!(caught instanceof AiUpstreamError)) throw caught
      err = caught
    }
    if (!err.retryable || attempt === attempts - 1) throw err
    lastError = err
    await sleep(2 ** attempt * 1000)
  }
  throw lastError
}

// Chat streaming is Gemini-only for now -- Anthropic's SSE event shape
// (message_start/content_block_delta/...) is different enough from
// Gemini's that supporting it isn't a small extension of this function, and
// Anthropic is untested in this app entirely (no key has ever been
// configured). Throws loudly rather than silently mishandling a tier that
// resolves to Anthropic.
//
// The OpenRouter fallback here is necessarily non-streaming (OpenRouter's
// own streaming format is a third, different SSE shape not worth adding for
// a last-resort path) -- on fallback the caller gets the whole answer as one
// `StreamChunk` instead of many small ones. The SSE contract this feeds
// (chat/route.ts's 'token' events) doesn't care how many chunks arrive.
export async function* streamGeminiText(
  tier: Tier,
  systemPrompt: string,
  userPrompt: string,
  opts?: { fetchImpl?: typeof fetch },
): AsyncGenerator<StreamChunk> {
  const fetchImpl = opts?.fetchImpl ?? fetch

  // Same explicit override as aiComplete. OpenRouter has no streaming
  // support here (see the file-level comment above), so a forced call
  // yields its whole answer as one chunk -- same shape callers already
  // handle for the fallback path below.
  if (forcedProvider() === 'openrouter') {
    const openRouterKey = process.env.OPENROUTER_API_KEY
    if (!openRouterKey) throw new AiDisabledError('AI_FORCE_PROVIDER=openrouter but OPENROUTER_API_KEY is not set')
    const result = await callOpenRouter(OPENROUTER_FALLBACK, openRouterKey, systemPrompt, userPrompt, fetchImpl)
    yield { textDelta: result.text }
    return
  }

  const spec = TIERS[tier]
  if (spec.provider !== 'gemini') {
    throw new AiUpstreamError(`Streaming is only implemented for Gemini, tier "${tier}" resolves to "${spec.provider}"`, false)
  }
  const apiKey = apiKeyFor('gemini')

  if (!apiKey) {
    const fallback = await openRouterFallback('gemini', systemPrompt, userPrompt, fetchImpl)
    if (fallback) {
      yield { textDelta: fallback.text }
      return
    }
    throw new AiDisabledError('No API key configured for provider "gemini"')
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:streamGenerateContent?alt=sse`
  let response: Response
  try {
    response = await fetchStreamWithRetry(url, apiKey, systemPrompt, userPrompt, fetchImpl)
  } catch (err) {
    const fallback = await openRouterFallback('gemini', systemPrompt, userPrompt, fetchImpl)
    if (fallback) {
      yield { textDelta: fallback.text }
      return
    }
    throw err
  }

  const reader = response.body!.getReader() // fetchStreamWithRetry only ever returns a response with a body
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // Gemini's SSE stream uses CRLF line endings, not bare LF -- normalize
    // before splitting, or "\n\n" never matches and every frame silently
    // buffers forever without yielding a single chunk.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

    // SSE frames are separated by a blank line; each frame's payload line
    // starts with "data: ". Buffer across chunk boundaries since a frame
    // can arrive split across multiple reads.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      const parsed = JSON.parse(payload)
      const text = (parsed.candidates?.[0]?.content?.parts ?? [])
        .map((part: { text?: string }) => part.text ?? '')
        .join('')
      if (text) yield { textDelta: text }
    }
  }
}
