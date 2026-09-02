// Turns a follow-up into a question that can stand on its own.
//
// Retrieval embeds the question and finds the clauses nearest to it. That
// works for "what is the notice period?" and fails completely for "and for
// the provider?", which is what people actually type once a conversation is
// running: embedded literally it is a bag of stopwords, the nearest clauses
// are arbitrary, and the answer is either wrong or NOT_FOUND. The fix is not
// a bigger retrieval budget -- it is asking the right question. So a
// follow-up is rewritten against the conversation so far into a standalone
// question, and THAT is what gets embedded.
//
// The rewrite is a real model call, so this module's job is equally about
// knowing when NOT to make it: a first message has no conversation to
// resolve against, and a question that already names its own subject gains
// nothing. Skipping those keeps the common case at its current latency.

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

/** How many turns of history are worth carrying. Two exchanges is enough to
    resolve "it"/"that clause"/"and the other party" and short enough not to
    push the real question out of the model's attention. */
export const HISTORY_TURNS = 4

// "this agreement", "the contract", "هذه الاتفاقية" point at the document
// every question here is already about -- not at anything said earlier.
// Removed before the referring-marker test, which would otherwise read the
// demonstrative in "under this agreement" as a follow-up and rewrite a
// perfectly self-contained question.
const SELF_REFERENCE = /\b(?:this|the)\s+(?:agreement|contract|document)\b/gi
const SELF_REFERENCE_AR = /(?:هذه|هذا|ال)\s*(?:الاتفاقية|اتفاقية|العقد|عقد|المستند|الوثيقة)/g

// A question with a subject of its own does not need the conversation to be
// understood. These are the markers of one that does: a pronoun or
// demonstrative standing in for something said earlier, or an opener that
// continues a previous question rather than starting a new one.
const REFERRING_MARKERS =
  /\b(it|its|it's|that|those|these|this|they|them|their|he|she|his|her|the same|instead|also|too|either|other|others|another|former|latter|previous|above|below)\b/i

const CONTINUATION_OPENERS = /^\s*(and|but|so|or|what about|how about|why not|then|also|ok|okay|yes|no)\b/i

// Arabic demonstratives and explicit back-references. Deliberately NOT the
// bare personal pronouns: "هو"/"هي" carry no back-reference on their own and
// open the ordinary interrogative "ما هو..." ("what is..."), so including
// them rewrote every standalone Arabic question.
const REFERRING_MARKERS_AR =
  /(هذا|هذه|ذلك|تلك|هؤلاء|أولئك|نفسه|نفسها|نفس|السابق|المذكور|الآخر|الأخرى|أيضا|أيضًا|كذلك|بدلا|بدلًا)/

// No \b here: JavaScript defines a word boundary over ASCII word characters
// only, so \b after an Arabic letter never matches and the whole pattern
// silently never fired.
const CONTINUATION_OPENERS_AR = /^\s*(وماذا عن|ماذا عن|ثم |طيب|حسنا|حسنًا|نعم |لا )/

// A question this short is almost never self-contained ("and the customer?",
// "in Arabic?"), whatever words it happens to use.
const SHORT_QUESTION_WORDS = 5

/**
 * Whether `question` can only be understood in the context of `history`.
 *
 * Deliberately errs toward false (answer the question as asked): a needless
 * rewrite costs a model call and risks distorting a question that was already
 * clear, while a missed one costs a single retrieval that the question's own
 * words could not have served anyway.
 */
export function needsHistoryContext(question: string, history: ConversationTurn[]): boolean {
  if (history.length === 0) return false

  const trimmed = question.trim()
  if (!trimmed) return false

  const wordCount = trimmed.split(/\s+/).length
  if (wordCount <= SHORT_QUESTION_WORDS) return true

  const probe = trimmed.replace(SELF_REFERENCE, ' ').replace(SELF_REFERENCE_AR, ' ')

  return (
    REFERRING_MARKERS.test(probe) ||
    CONTINUATION_OPENERS.test(trimmed) ||
    REFERRING_MARKERS_AR.test(probe) ||
    CONTINUATION_OPENERS_AR.test(trimmed)
  )
}

/** The last few turns, oldest first -- what the rewrite resolves against. */
export function recentTurns(history: ConversationTurn[], limit: number = HISTORY_TURNS): ConversationTurn[] {
  return history.slice(-limit)
}

// The rewrite is only useful if it stays a question about this contract. A
// model asked to "make this standalone" will sometimes answer it instead,
// apologise, or return an empty string -- none of which is a search query.
const MAX_CONDENSED_CHARS = 400

/**
 * How long the rewrite is allowed to delay the answer.
 *
 * It buys better retrieval, and it buys it by putting a second model call in
 * front of the first token. Measured live at 0.5-6.6s depending on whether
 * the provider retried, which is a lot to add to a follow-up. Past this the
 * question is retrieved on the user's own words instead: a slightly worse
 * retrieval beats a noticeably slower answer, and the request the rewrite
 * would have made is already wasted either way.
 */
export const CONDENSE_TIMEOUT_MS = Number(process.env.CHAT_CONDENSE_TIMEOUT_MS ?? 4000)

/**
 * Accepts a rewritten question, or falls back to the original.
 *
 * The fallback is the safe direction: retrieving on the user's own words is
 * exactly today's behaviour, whereas retrieving on a degenerate rewrite is
 * strictly worse than not rewriting at all.
 */
export function acceptCondensed(condensed: string, original: string): string {
  const cleaned = condensed.trim().replace(/^["'“”]|["'“”]$/g, '').trim()
  if (!cleaned) return original
  if (cleaned.length > MAX_CONDENSED_CHARS) return original
  // A rewrite that lost the question entirely is not a search query.
  if (cleaned.split(/\s+/).length < 2) return original
  return cleaned
}
