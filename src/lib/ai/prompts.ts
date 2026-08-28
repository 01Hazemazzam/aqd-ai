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

export class MalformedAiResponseError extends Error {
  constructor(task: string, cause: unknown) {
    super(`Malformed AI response for task "${task}": ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'MalformedAiResponseError'
  }
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
  const candidate = (fenced ? fenced[1] : text).trim()
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
