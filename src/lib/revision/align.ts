// Aligning one version of a contract against the next.
//
// The question a lawyer asks of a returned draft is not "what does this
// document say" but "what did they change" -- and the document itself will
// not tell you. Counterparties renumber, reorder, split one clause into two,
// and delete a sentence in the middle of a paragraph. So the alignment has to
// be recovered from the text.
//
// This is deliberately not an AI task. A model asked "which clause in v2
// corresponds to clause 7 of v1" would be confident and occasionally wrong,
// and a wrong pairing is worse than no pairing: it reports a change that
// never happened, or hides one that did. Everything here is deterministic and
// reproducible, and every pairing is one a reader can check by eye.
//
// Three passes, strongest evidence first, each consuming what it matches:
//
//   1. identical text     -- the clause is untouched, whatever it is numbered
//   2. same clause number -- the same slot in the document, edited
//   3. similar text       -- a renumbered clause, matched on word overlap
//
// Order matters. Running similarity first would let a heavily-edited clause
// steal the partner of an untouched one, because similarity is greedy and
// identity is not negotiable.

export interface RevisionClause {
  id: string
  ordinal: number
  clauseNumber: string | null
  lang: 'ar' | 'en'
  body: string
}

export type ClauseChange =
  | { kind: 'unchanged'; base: RevisionClause; revised: RevisionClause }
  | { kind: 'modified'; base: RevisionClause; revised: RevisionClause; similarity: number }
  | { kind: 'added'; revised: RevisionClause }
  | { kind: 'removed'; base: RevisionClause }

export interface RevisionComparison {
  /** In the revised document's own reading order. A removed clause has no
      place of its own there, so it is emitted directly after whichever
      surviving clause preceded it in the base document -- which is where a
      reader looking for it would go. */
  changes: ClauseChange[]
  counts: { unchanged: number; modified: number; added: number; removed: number }
  /** Nothing changed at all. Distinct from an empty comparison: two versions
      of an empty document are identical, and two empty lists are not a
      statement about anything. */
  identical: boolean
}

/** Word overlap below which two clauses are treated as unrelated rather than
    edited. Set from the failure that matters more: a false pairing invents an
    edit and buries a deletion, where a missed pairing shows the same content
    as one removal and one addition -- wrong, but wrong in a way the reader
    can see and correct. Hence a threshold that errs high. */
const SIMILARITY_FLOOR = 0.45

// Folded before comparison so that a change of quotation mark, dash width, or
// decorative elongation does not read as an amendment. What is NOT folded is
// different words -- that is the thing being detected.
function normalize(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[  -  　]/g, ' ')
    // Arabic tatweel is decorative elongation and carries no meaning.
    .replace(/ـ/g, '')
    // Harakat are optional vowel marks; the same clause is routinely typed
    // with and without them.
    .replace(/[ً-ْٰ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Clause numbers arrive as "7", "7.", Arabic-Indic "٧", "Article 7" and
// "(7)" for the same provision, and an Arabic document numbers in Arabic-Indic
// digits where its English counterpart does not.
function normalizeNumber(raw: string | null): string | null {
  if (!raw) return null
  const folded = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[^0-9a-zء-ي.]+/g, ' ')
    .trim()
  return folded || null
}

function tokens(normalized: string): Set<string> {
  const out = new Set<string>()
  for (const t of normalized.split(/[^0-9a-zء-ي]+/)) {
    if (t) out.add(t)
  }
  return out
}

/** Dice coefficient over the two token sets: twice the shared vocabulary over
    the combined vocabulary. Chosen over raw overlap because it is symmetric
    and does not reward length -- a long clause should not match everything
    simply by containing more words. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const t of small) if (large.has(t)) shared++
  return (2 * shared) / (a.size + b.size)
}

/**
 * Pair the clauses of two versions of one contract.
 *
 * Both lists are expected in document order; neither is mutated. The result
 * is complete in both directions: every base clause appears exactly once as
 * unchanged, modified or removed, and every revised clause exactly once as
 * unchanged, modified or added.
 */
export function compareVersions(base: RevisionClause[], revised: RevisionClause[]): RevisionComparison {
  const baseNorm = base.map((c) => normalize(c.body))
  const revisedNorm = revised.map((c) => normalize(c.body))

  /** revised index -> base index */
  const partnerOfRevised = new Map<number, number>()
  const pairedBase = new Set<number>()

  // Pass 1: identical text. Bucketed by body rather than compared pairwise so
  // that a document repeating the same boilerplate twice pairs the first with
  // the first and the second with the second, instead of both with the first.
  const identicalBuckets = new Map<string, number[]>()
  baseNorm.forEach((body, i) => {
    const bucket = identicalBuckets.get(body)
    if (bucket) bucket.push(i)
    else identicalBuckets.set(body, [i])
  })
  revisedNorm.forEach((body, j) => {
    const bucket = identicalBuckets.get(body)
    if (!bucket?.length) return
    const i = bucket.shift() as number
    partnerOfRevised.set(j, i)
    pairedBase.add(i)
  })

  // Pass 2: same clause number. Only when that number identifies exactly one
  // unpaired clause on each side -- a document that reuses "1" for a schedule
  // and for section 1 gives the number no evidential weight at all.
  const byNumber = (clauses: RevisionClause[], skip: (idx: number) => boolean) => {
    const seen = new Map<string, number[]>()
    clauses.forEach((c, idx) => {
      if (skip(idx)) return
      const key = normalizeNumber(c.clauseNumber)
      if (!key) return
      const bucket = seen.get(key)
      if (bucket) bucket.push(idx)
      else seen.set(key, [idx])
    })
    return seen
  }
  const baseByNumber = byNumber(base, (i) => pairedBase.has(i))
  const revisedByNumber = byNumber(revised, (j) => partnerOfRevised.has(j))
  for (const [key, revisedIdxs] of revisedByNumber) {
    const baseIdxs = baseByNumber.get(key)
    if (revisedIdxs.length !== 1 || baseIdxs?.length !== 1) continue
    partnerOfRevised.set(revisedIdxs[0], baseIdxs[0])
    pairedBase.add(baseIdxs[0])
  }

  // Pass 3: word overlap, best pair first. Sorting every candidate pair by
  // score and taking them greedily makes each accepted pairing mutually best
  // among what is still available, which is what stops one heavily-rewritten
  // clause from claiming a partner that suits another clause better.
  const baseTokens = baseNorm.map(tokens)
  const revisedTokens = revisedNorm.map(tokens)
  const candidates: Array<{ i: number; j: number; score: number }> = []
  for (let j = 0; j < revised.length; j++) {
    if (partnerOfRevised.has(j)) continue
    for (let i = 0; i < base.length; i++) {
      if (pairedBase.has(i)) continue
      const score = similarity(baseTokens[i], revisedTokens[j])
      if (score >= SIMILARITY_FLOOR) candidates.push({ i, j, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.i - a.j) - Math.abs(b.i - b.j))
  for (const { i, j } of candidates) {
    if (pairedBase.has(i) || partnerOfRevised.has(j)) continue
    partnerOfRevised.set(j, i)
    pairedBase.add(i)
  }

  // Emit in the revised document's order, hanging each removed clause off the
  // last surviving clause that preceded it.
  const removedAfterBase = new Map<number, number[]>()
  const removedAtStart: number[] = []
  let lastPairedBase = -1
  for (let i = 0; i < base.length; i++) {
    if (pairedBase.has(i)) {
      lastPairedBase = i
      continue
    }
    if (lastPairedBase < 0) removedAtStart.push(i)
    else {
      const bucket = removedAfterBase.get(lastPairedBase)
      if (bucket) bucket.push(i)
      else removedAfterBase.set(lastPairedBase, [i])
    }
  }

  const changes: ClauseChange[] = []
  const counts = { unchanged: 0, modified: 0, added: 0, removed: 0 }
  const pushRemoved = (idxs: number[] | undefined) => {
    for (const i of idxs ?? []) {
      changes.push({ kind: 'removed', base: base[i] })
      counts.removed++
    }
  }

  pushRemoved(removedAtStart)
  for (let j = 0; j < revised.length; j++) {
    const i = partnerOfRevised.get(j)
    if (i === undefined) {
      changes.push({ kind: 'added', revised: revised[j] })
      counts.added++
      continue
    }
    if (baseNorm[i] === revisedNorm[j]) {
      changes.push({ kind: 'unchanged', base: base[i], revised: revised[j] })
      counts.unchanged++
    } else {
      changes.push({
        kind: 'modified',
        base: base[i],
        revised: revised[j],
        similarity: similarity(baseTokens[i], revisedTokens[j]),
      })
      counts.modified++
    }
    pushRemoved(removedAfterBase.get(i))
  }

  return {
    changes,
    counts,
    identical: counts.modified === 0 && counts.added === 0 && counts.removed === 0,
  }
}
