// Brings a clause into view in the contract reader and flashes it, so the
// reader can tell WHICH clause it just jumped to. Two surfaces arrive at a
// clause and both need the identical landing: a chat citation `[n]` clicked
// in-page, and a risk-portfolio drill-down arriving via a `#clause-<id>` URL
// hash from another route. One implementation keeps them from drifting apart.
//
// Depends on the reader rendering each clause with id="clause-<clauseId>"
// (see ClauseRow) and on the .clause-flash keyframes in globals.css.

export function focusClause(clauseId: string): boolean {
  const el = document.getElementById(`clause-${clauseId}`)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('clause-flash')
  // Force a reflow so re-adding the class replays the animation even if
  // the same clause was just flashed a moment ago.
  void el.offsetWidth
  el.classList.add('clause-flash')
  return true
}
