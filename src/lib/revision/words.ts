// Word-level diff, for showing what an edit actually did to a clause.
//
// Saying "clause 7 was modified" is nearly useless on a 200-word indemnity:
// the reader still has to compare two paragraphs by eye, which is the work
// they came here to avoid. The change worth seeing is usually three words --
// a cap raised, a "shall" turned into a "may", a carve-out inserted -- and it
// hides in the middle of text that is otherwise identical.
//
// Classic LCS, with the common prefix and suffix trimmed first. That trim is
// not an optimisation detail: contract edits are overwhelmingly small changes
// inside long unchanged text, so it collapses the quadratic table to almost
// nothing in exactly the case this module exists for.

export type DiffSegment = { kind: 'equal' | 'added' | 'removed'; text: string }

/** Above this many cells the table is not worth building. A clause that far
    apart from its partner is a rewrite, and word-level marking of a rewrite
    is noise -- the honest rendering is "this became that". */
const MAX_CELLS = 400_000

// Whitespace is normalized away rather than diffed. A re-wrapped paragraph
// changes every newline in the document and none of its meaning, and a diff
// that reports it would drown the three words that matter.
function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

function push(out: DiffSegment[], kind: DiffSegment['kind'], token: string) {
  const last = out[out.length - 1]
  if (last?.kind === kind) last.text += ` ${token}`
  else out.push({ kind, text: token })
}

/**
 * The edit that turns `before` into `after`, as a run of segments.
 *
 * Segments are in reading order and, concatenated, reproduce `before` when
 * the added ones are dropped and `after` when the removed ones are -- which
 * is what lets one rendering show both documents at once.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before)
  const b = tokenize(after)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++

  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++

  const aMid = a.slice(start, a.length - end)
  const bMid = b.slice(start, b.length - end)

  const out: DiffSegment[] = []
  for (let i = 0; i < start; i++) push(out, 'equal', a[i])

  if (aMid.length * bMid.length > MAX_CELLS) {
    for (const t of aMid) push(out, 'removed', t)
    for (const t of bMid) push(out, 'added', t)
  } else {
    // lcs[i][j] = length of the longest common subsequence of aMid[i..] and
    // bMid[j..]. Built from the end so the walk below runs forwards, which is
    // the order the segments have to come out in.
    const width = bMid.length + 1
    const lcs = new Uint32Array((aMid.length + 1) * width)
    for (let i = aMid.length - 1; i >= 0; i--) {
      for (let j = bMid.length - 1; j >= 0; j--) {
        lcs[i * width + j] =
          aMid[i] === bMid[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
      }
    }

    let i = 0
    let j = 0
    while (i < aMid.length && j < bMid.length) {
      if (aMid[i] === bMid[j]) {
        push(out, 'equal', aMid[i])
        i++
        j++
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        push(out, 'removed', aMid[i])
        i++
      } else {
        push(out, 'added', bMid[j])
        j++
      }
    }
    while (i < aMid.length) push(out, 'removed', aMid[i++])
    while (j < bMid.length) push(out, 'added', bMid[j++])
  }

  for (let k = b.length - end; k < b.length; k++) push(out, 'equal', b[k])

  return out
}
