export interface PromptClause {
  id: string
  clauseNumber: string | null
  body: string
}

export interface PlaybookRule {
  ruleKey: string
  title: string
  description: string
  severityHint: 'high' | 'medium' | 'low'
}

const HARD_RULES = `Hard rules:
- Base every answer only on the clause text provided. Never invent a fact that isn't in the document.
- When a value is genuinely absent from the document, use JSON null -- never guess or fabricate a plausible-sounding value.
- Reference clauses only by the "id" field given to you. Never invent a clause id.
- A finding about a clause the document is missing entirely (e.g. no termination clause) uses "clauseId": null.
- Write free-text values in the same language as the clause text they describe. If the document (or the relevant clause) is in Arabic, write in Arabic throughout, including any clause references -- do not leave structural words like "clause" in English inside an otherwise-Arabic sentence.
- When referring to a specific named part of the document itself (e.g. "Exhibit A", "Schedule 1", "Appendix B"), keep that reference as written in the source rather than translating the generic word -- e.g. write "الملحق A" or keep "Exhibit A" as-is. Never translate "Exhibit" as "معرض" (which means "exhibition/gallery", a different word entirely) -- it is a document reference, not the everyday noun.
- Output must be a single JSON object and nothing else -- no markdown fences, no commentary before or after.`

// Plain rendering for tasks whose JSON output has no clause-id field at all
// (summary, fields). A real Gemini summary once quoted the internal
// `[id=...]` clause markers verbatim in its prose -- the fix isn't a "don't
// mention ids" rule, it's not handing the model ids it has no schema field
// to put them in. The parenthetical number is language-neutral (no English
// word "clause") since an earlier version's English exemplar was echoed
// verbatim into otherwise-Arabic summaries.
function renderClausesPlain(clauses: PromptClause[]): string {
  return clauses.map((c) => (c.clauseNumber ? `(${c.clauseNumber})\n${c.body}` : c.body)).join('\n\n')
}

// Id-tagged rendering for tasks whose JSON output references a clause by id
// (risks, obligations).
function renderClausesWithIds(clauses: PromptClause[]): string {
  return clauses
    .map((c) => `[id=${c.id}]${c.clauseNumber ? ` (${c.clauseNumber})` : ''}\n${c.body}`)
    .join('\n\n')
}

export function summaryPrompt(clauses: PromptClause[]) {
  return {
    system: `You are a contract analyst. Summarize the contract below in 2-4 plain-language sentences a business reader can act on. ${HARD_RULES}\n\nRespond with JSON: {"summary": string}.`,
    user: renderClausesPlain(clauses),
  }
}

export function fieldsPrompt(clauses: PromptClause[]) {
  return {
    system: `You are a contract analyst extracting key fields. ${HARD_RULES}\n\nRespond with JSON matching exactly this shape:\n{"parties": string[] | null, "effectiveDate": string | null, "termLength": string | null, "governingLaw": string | null, "totalValue": string | null}`,
    user: renderClausesPlain(clauses),
  }
}

export function risksPrompt(clauses: PromptClause[], rules: PlaybookRule[]) {
  const ruleList = rules
    .map((r) => `- ${r.ruleKey}: ${r.title} -- ${r.description} (typical severity: ${r.severityHint})`)
    .join('\n')
  return {
    system: `You are a contract risk reviewer. Score the contract against this playbook of rules:\n${ruleList}\n\n${HARD_RULES}\n\nFor each rule, only report a finding if the contract actually violates it or is missing something the rule requires -- do not report a finding for a rule the contract already satisfies.\n\nSome rules describe a problem with a clause type only when that clause type is present and badly worded (for example: an auto-renewal clause with no opt-out notice period, an indemnification clause that only protects one party, liability language that is unlimited or one-sided, amendment rights held by only one party). The clause type simply being absent from the contract is NOT a violation of these rules and must not be reported -- a contract with no auto-renewal clause, no indemnification clause, or no amendment clause at all has nothing for that rule to flag. Only report a missing-clause finding when the rule's own description explicitly requires the clause type's presence (for example, wording like "should include" or "should state"). Respond with JSON: {"findings": [{"clauseId": string | null, "ruleKey": string, "severity": "high" | "medium" | "low", "title": string, "reason": string, "reasonAr": string}]}. "reasonAr" is the same reason written in Arabic. An empty findings array is a valid answer.`,
    user: renderClausesWithIds(clauses),
  }
}

export function obligationsPrompt(clauses: PromptClause[]) {
  return {
    system: `You are a contract analyst extracting obligations -- who must do what, by when. ${HARD_RULES}\n\nRespond with JSON: {"obligations": [{"clauseId": string | null, "obligor": string, "action": string, "due": string | null}]}. "due" is the stated deadline or trigger in the document's own words, or null if none is stated. Do not compute or infer a date that isn't written in the document. An empty obligations array is a valid answer.`,
    user: renderClausesWithIds(clauses),
  }
}

export interface RetrievedClause {
  clauseNumber: string | null
  lang: 'ar' | 'en'
  body: string
}

const NOT_FOUND_TOKEN = 'NOT_FOUND'

// Retrieved clauses are numbered 1..N in retrieval order for citation
// purposes -- deliberately NOT the document's own clause_number (which can
// repeat across contracts, be null for a paragraph-fallback clause, or not
// match retrieval order), so [n] always resolves unambiguously to exactly
// one of the clauses actually shown to the model.
function renderRetrievedClauses(clauses: RetrievedClause[]): string {
  return clauses.map((c, i) => `[${i + 1}]\n${c.body}`).join('\n\n')
}

export function chatPrompt(question: string, retrievedClauses: RetrievedClause[]) {
  const system = `You are a contract Q&A assistant. Answer the user's question using ONLY the numbered clauses below -- they are the only excerpts retrieved as relevant to this question, not the whole document, so don't assume anything not shown here.

Hard rules:
- Answer only from the clause text given. Never use outside knowledge, never guess, never invent a fact.
- Cite every factual claim with [n], where n is the bracketed number of the clause it came from. A claim with no supporting clause below must not be made at all.
- If the clauses below do not contain the answer, respond with exactly this and nothing else: ${NOT_FOUND_TOKEN}
- Write your answer in the same language as the question -- always, even when the clause you are citing is written in a different language than the question. Translate the fact into the question's language; do not switch to the clause's language just because that is the language you are quoting from. (Example: an English question grounded in an Arabic clause still gets an English answer.)
- When referring to a specific named part of the document itself (e.g. "Exhibit A", "Schedule 1"), keep that reference as written in the source rather than translating the generic word -- e.g. write "الملحق A" or keep "Exhibit A" as-is, never "معرض" ("exhibition/gallery").
- Do not fabricate a clause reference. Only use [n] values that appear in the numbered list below.
- Plain text only -- no JSON, no markdown formatting.

Clauses:
${renderRetrievedClauses(retrievedClauses)}`

  return { system, user: question }
}

export function isNotFoundAnswer(text: string): boolean {
  return text.trim() === NOT_FOUND_TOKEN
}

export interface CitationMatch {
  id: string
  clauseNumber: string | null
}

export interface ResolvedCitation {
  ordinal: number
  clauseId: string
  clauseNumber: string | null
}

// Maps every [n] marker found in the answer text to the retrieved clause it
// actually points to. An ordinal outside 1..matches.length -- a
// model-invented or otherwise wrong citation -- is dropped here, not
// persisted: [n] can only ever mean "the nth clause actually shown to the
// model this turn," never a clause the caller has to trust the model got
// right on its own.
export function resolveCitations(text: string, matches: CitationMatch[]): ResolvedCitation[] {
  return extractCitationOrdinals(text)
    .filter((n) => n >= 1 && n <= matches.length)
    .map((n) => ({ ordinal: n, clauseId: matches[n - 1].id, clauseNumber: matches[n - 1].clauseNumber }))
}

// Matches [1], [2], etc. -- returns the unique set of 1-indexed positions
// cited, in first-seen order.
export function extractCitationOrdinals(text: string): number[] {
  const seen = new Set<number>()
  const ordinals: number[] = []
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1])
    if (!seen.has(n)) {
      seen.add(n)
      ordinals.push(n)
    }
  }
  return ordinals
}

export class MalformedAiResponseError extends Error {
  constructor(task: string, cause: unknown) {
    super(`Malformed AI response for task "${task}": ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'MalformedAiResponseError'
  }
}

// A real Gemini Arabic summary once contained a single Hebrew character
// (U+05E8, "resh") standing in for its visually near-identical Arabic
// counterpart ("ر", reh, U+0631) in the middle of an otherwise-correct word
// ("للמרخص" instead of "للمرخص") -- a generation-time script mix-up, not a
// translation or grounding error. Narrow, evidence-based fix: normalize the
// one confirmed homoglyph back to Arabic, rather than a broad Hebrew-range
// strip that could damage legitimate text this app has no reason to expect
// in the first place (this app has no Hebrew content anywhere).
const HEBREW_ARABIC_HOMOGLYPHS: Record<string, string> = {
  'ר': 'ر', // Hebrew resh -> Arabic reh
}

export function repairHebrewArabicHomoglyphs(text: string): string {
  return text.replace(/[֐-׿]/g, (ch) => HEBREW_ARABIC_HOMOGLYPHS[ch] ?? ch)
}

// A real Gemini risk-findings response (Arabic reasonAr text, long output)
// failed with "Bad Unicode escape in JSON" -- a stray backslash not part of
// a valid JSON escape, most often produced inside non-Latin text. Retrying
// with every such backslash escaped recovers the real content instead of
// losing the entire response (and every other finding in it) to one bad
// byte.
function repairStrayBackslashes(text: string): string {
  return text.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\')
}

export function extractJson<T>(task: string, text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = repairHebrewArabicHomoglyphs((fenced ? fenced[1] : text).trim())
  try {
    return JSON.parse(candidate) as T
  } catch (err) {
    try {
      return JSON.parse(repairStrayBackslashes(candidate)) as T
    } catch {
      throw new MalformedAiResponseError(task, err)
    }
  }
}
