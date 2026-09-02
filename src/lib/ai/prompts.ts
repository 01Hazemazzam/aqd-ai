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

// Shared by both risk passes: how to quote, and how to grade. Kept in one
// place because the two passes produce findings of the same shape and are
// verified by the same code -- a rule that drifts between them shows up as
// one pass's findings being silently discarded.
const EVIDENCE_RULES = `Every finding must quote the words it rests on. "evidence" is a list; each entry names a clause by its id and gives a short excerpt (roughly 5-30 words) copied EXACTLY, character for character, from that clause's body -- the specific words that make this a risk. Copy, do not paraphrase, do not tidy up the wording, and do not translate it: quote each clause in the language it is written in. Use "..." to skip over the middle of a long passage. If you cannot point to actual words that show the problem, do not report the finding at all. A finding whose quote is not genuinely present in the clause it is attributed to is discarded before it ever reaches the user, so an unquotable finding is worse than no finding.`

const SEVERITY_RULES = `Severity: "high" for something that could cause uncapped financial loss, let the other party exit or change the deal unilaterally, or leave a critical protection entirely absent; "medium" for a one-sided or unclear term that is still bounded; "low" for a gap worth noting that carries little immediate exposure. Judge the actual wording in front of you, not any typical severity -- a typical severity is a starting point, not the answer.`

export function risksPrompt(clauses: PromptClause[], rules: PlaybookRule[]) {
  const ruleList = rules
    .map((r) => `- ${r.ruleKey}: ${r.title} -- ${r.description} (typical severity: ${r.severityHint})`)
    .join('\n')
  return {
    system: `You are a contract risk reviewer. Score the contract against this playbook of rules:\n${ruleList}\n\n${HARD_RULES}\n\nFor each rule, only report a finding if the contract actually violates it or is missing something the rule requires -- do not report a finding for a rule the contract already satisfies.\n\nSome rules describe a problem with a clause type only when that clause type is present and badly worded (for example: an auto-renewal clause with no opt-out notice period, an indemnification clause that only protects one party, liability language that is unlimited or one-sided, amendment rights held by only one party). The clause type simply being absent from the contract is NOT a violation of these rules and must not be reported -- a contract with no auto-renewal clause, no indemnification clause, or no amendment clause at all has nothing for that rule to flag. Only report a missing-clause finding when the rule's own description explicitly requires the clause type's presence (for example, wording like "should include" or "should state"). ${EVIDENCE_RULES}

${SEVERITY_RULES}

Respond with JSON: {"findings": [{"ruleKey": string, "severity": "high" | "medium" | "low", "title": string, "reason": string, "reasonAr": string, "evidence": [{"clauseId": string, "quote": string}]}]}. "reasonAr" is the same reason written in Arabic. "evidence" is an empty list only for a finding about a clause the document does not contain, since there is nothing to quote. An empty findings array is a valid answer.`,
    user: renderClausesWithIds(clauses),
  }
}

// The second risk pass, and the one a playbook checklist structurally cannot
// do. Every playbook rule asks a question about ONE clause ("is liability
// capped?", "is there a governing law?"), so a well-drafted contract passes
// all of them and the analysis reports nothing -- even when its clauses,
// read together, hand one party a right the other does not have, or say two
// incompatible things about the same subject. Those risks live in the
// relationships BETWEEN clauses, so this pass is given the whole document at
// once and asked only about relationships.
//
// The failure mode to guard against here is the opposite of the playbook
// pass's: with an open-ended "find asymmetries" brief a model will
// manufacture them, reporting a difference between clauses that the contract
// itself resolves ("the renewal right is mutual"). Hence the insistence that
// a relational finding quote BOTH sides -- a fabricated asymmetry usually
// cannot produce a second quote, and the verifier drops it when it does not.
export function crossClausePrompt(clauses: PromptClause[]) {
  return {
    system: `You are a senior contract lawyer reading a contract as a whole. You are NOT checking a compliance checklist -- another reviewer already does that, and duplicating it is wasted work. Your job is the risks that only appear when two or more clauses are read together:

- "asymmetry": one party has a right, remedy, notice period, cure period, liability exposure or termination option that the other party does not, or has on materially worse terms.
- "contradiction": two clauses state incompatible things about the same subject -- different deadlines, notice periods, amounts, governing texts, or one clause granting what another withholds.
- "dependency": one clause's protection is undercut, conditioned on, or made unusable by another clause elsewhere in the document (for example a cap that an exclusion elsewhere swallows, or a right whose exercise a different clause blocks).

${HARD_RULES}

Report a finding only when the contract text actually shows it. Contracts routinely and legitimately treat the parties differently, and a difference is not automatically a risk -- an asymmetry is worth reporting when it leaves one party materially exposed or without recourse. If a clause explicitly resolves the point (for example by stating that a right is mutual, or that one document controls over another), there is no finding: the contract has already answered it, and reporting it anyway is a false positive that costs the reader more than the finding is worth. Do not report a risk that lives entirely inside one clause -- that is the other reviewer's job.

${EVIDENCE_RULES} Quote EVERY clause the finding involves, and quote the words that actually make the two sides differ -- not the clause's opening line. A "contradiction" or a "dependency" is a statement about two places in the document and must quote at least two different clauses; a finding of either kind quoting only one clause is discarded, because a single quote cannot show it. An "asymmetry" usually also needs two clauses (the one granting the right, and the one that gives the other party nothing comparable), but when a single clause states both sides itself -- for example by saying outright that the other party has no equivalent right -- quoting that one clause is enough and is the strongest evidence available.

${SEVERITY_RULES}

Respond with JSON: {"findings": [{"kind": "asymmetry" | "contradiction" | "dependency", "severity": "high" | "medium" | "low", "title": string, "reason": string, "reasonAr": string, "evidence": [{"clauseId": string, "quote": string}]}]}. "reason" must say what each quoted clause contributes and why the combination is a risk. "reasonAr" is the same reason written in Arabic. An empty findings array is a valid answer, and is the right answer for a contract whose clauses are consistent and even-handed.`,
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

// Sub-project 5's exit test: "answers product questions and cannot answer
// data questions." Deliberately given ZERO contract/clause/analysis/team
// data in its context -- unlike chatPrompt, there is nothing here to
// citation-lock against, so the guarantee is architectural (it is never
// handed any real data to leak) rather than something the model has to be
// trusted to withhold. The one thing that still depends on the model is
// *recognizing* a data question and refusing rather than inventing a
// plausible-sounding but fabricated answer -- that's what the live
// verification for this feature actually tests.
const PRODUCT_KNOWLEDGE = `Aqd is a bilingual (Arabic/English) AI contract-analysis platform. What it actually does:
- Upload a contract as PDF or DOCX; it's parsed and split into numbered clauses, each rendered in its own original language.
- "Analyze" runs four AI tasks against the uploaded contract: a plain-language summary, key fields (parties, term, governing law, total value, effective date), a risk review scored against a legal playbook, and a list of obligations (who must do what, by when). Risk findings show as severity markers next to the clause they apply to.
- The contract chat answers questions using only that specific contract's own clauses, with clickable citations back to the source clause -- it refuses to answer anything the document doesn't state, rather than guessing.
- Team management (Settings > Team): organization owners and admins can invite members by email with a role (member, admin, owner), change a member's role, and remove members. An organization must always keep at least one owner.
- Security (Settings > Security): sign-in supports email+password -- with a 6-digit emailed code on an unrecognized device and "trust this device for 30 days" -- or Google sign-in. The security page lists trusted devices (each revocable) and a recent account-activity log.
- The theme (light/dark) and language (Arabic/English) toggles live in the app header, available on every page.`

export function productHelperPrompt(question: string) {
  const system = `You are Aqd's product help assistant. You answer questions about how the Aqd product works and how to use it -- nothing else.

${PRODUCT_KNOWLEDGE}

Hard rules:
- You have NO access to any user's contracts, clauses, analyses, risk findings, obligations, chat history, team members, or any other account data -- none of it is available to you, under any circumstance.
- If asked about the content of a specific contract -- an amount, a date, a party name, a clause, a risk finding, or anything else that would require looking at a user's actual data -- you must refuse and redirect: tell them to open that contract and use its own chat, which is the feature that actually has access to it. Never guess or fabricate an answer to a data question; that would be worse than refusing.
- If a question isn't about the Aqd product at all (general knowledge, other software, anything unrelated), say plainly that this isn't something you can help with here.
- Write your answer in the same language as the question.
- Keep answers short and practical -- a few sentences, not an essay.
- Plain text only -- no JSON, no markdown formatting.`

  return { system, user: question }
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

// A real gemini-flash-lite-latest response returned a valid JSON object
// immediately followed by unfenced prose commentary ("...} Note that this
// contract does not..."), failing with "Unexpected non-whitespace character
// after JSON" even though the JSON value itself was perfectly formed -- the
// lighter model is more prone to this than the main tier. Scans from the
// first `{`/`[` and returns just the substring up to its matching close
// (bracket-depth counting that respects string literals/escapes), so a
// trailing-commentary response can still be parsed instead of discarded
// whole.
function extractBalancedJsonSubstring(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{' || ch === '[') {
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function tryParseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    /* fall through to the caller's next attempt */
  }
  try {
    return JSON.parse(repairStrayBackslashes(text)) as T
  } catch {
    return undefined
  }
}

export function extractJson<T>(task: string, text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = repairHebrewArabicHomoglyphs((fenced ? fenced[1] : text).trim())

  const direct = tryParseJson<T>(candidate)
  if (direct !== undefined) return direct

  const balanced = extractBalancedJsonSubstring(candidate)
  const fromBalanced = balanced !== null ? tryParseJson<T>(balanced) : undefined
  if (fromBalanced !== undefined) return fromBalanced

  try {
    JSON.parse(candidate)
  } catch (err) {
    throw new MalformedAiResponseError(task, err)
  }
  // Unreachable: JSON.parse(candidate) failing is exactly what got us here.
  throw new MalformedAiResponseError(task, new Error('invalid JSON'))
}
