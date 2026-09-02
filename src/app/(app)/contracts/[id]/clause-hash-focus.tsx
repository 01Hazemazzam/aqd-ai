'use client'
import { useEffect } from 'react'
import { focusClause } from '@/lib/clause/focus'

// Lands a drill-down from the risk portfolio: /contracts/<id>#clause-<clauseId>
// arrives here, and this scrolls to that clause and flashes it -- the same
// landing a chat citation gives, so a finding and a citation behave identically
// once you're in the reader.
//
// Renders nothing. The browser's native hash scroll is unreliable for this page
// (the clause list renders after the analysis cards resolve, so the anchor
// often isn't in the document at navigation time), and native scrolling never
// flashes. A rAF defers to after paint so the element exists to measure.
export function ClauseHashFocus() {
  useEffect(() => {
    const match = window.location.hash.match(/^#clause-([\w-]+)$/)
    if (!match) return
    const frame = requestAnimationFrame(() => focusClause(match[1]))
    return () => cancelAnimationFrame(frame)
  }, [])

  return null
}
