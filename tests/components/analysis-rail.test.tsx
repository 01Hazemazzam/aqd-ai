// tests/components/analysis-rail.test.tsx
//
// The rail is where the reader's two long-standing UX problems were fixed:
// every risk finding is now ONE list (previously split between an inline
// clause gutter and a separate "other findings" card), and a finding quotes
// its own evidence inline instead of making the reader travel down the
// document. These assert that observable behaviour through the rendered
// output, so they survive a restyle.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnalysisRail, type RailClause, type RailFinding } from '@/app/(app)/contracts/[id]/analysis-rail'

// t() returns the key, except clauseHeading which interpolates, so assertions
// read against stable keys rather than English copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    key === 'clauseHeading' ? `Clause ${values?.number}` : key,
}))

// Chat is exercised in chat-widget.test.tsx; here it would only drag a live
// fetch/stream into the test.
vi.mock('@/app/(app)/contracts/[id]/chat-panel', () => ({
  ContractChat: () => <div>chat-mounted</div>,
}))

const focusClause = vi.fn()
vi.mock('@/lib/clause/focus', () => ({ focusClause: (id: string) => focusClause(id) }))

const CLAUSES: RailClause[] = [
  { id: 'c1', ordinal: 1, clauseNumber: '11', lang: 'en', body: 'Limitation of Liability. Each party is capped.' },
  { id: 'c2', ordinal: 2, clauseNumber: '12', lang: 'en', body: 'Indemnification. Customer shall indemnify.' },
  { id: 'c3', ordinal: 3, clauseNumber: '13', lang: 'en', body: 'Termination. Customer may exit at will.' },
]

const ANCHORED: RailFinding = {
  id: 'f1',
  clauseId: 'c1',
  kind: 'playbook',
  severity: 'high',
  title: 'Unlimited Liability for Provider',
  reason: 'Liability is uncapped.',
  evidence: [{ clauseId: 'c1', quote: 'Each party is capped.' }],
}

const UNPLACED: RailFinding = {
  id: 'f2',
  clauseId: null,
  kind: 'playbook',
  severity: 'medium',
  title: 'Missing Governing Law',
  reason: 'No governing law is named.',
  evidence: [],
}

// A cross-clause finding: the claim is about how two clauses relate, so it
// carries a quote from each.
const RELATIONAL: RailFinding = {
  id: 'f3',
  clauseId: 'c3',
  kind: 'asymmetry',
  severity: 'medium',
  title: 'Termination is one-sided',
  reason: 'Customer may exit; the provider cannot.',
  evidence: [
    { clauseId: 'c3', quote: 'Customer may exit at will.' },
    { clauseId: 'c2', quote: 'Customer shall indemnify.' },
  ],
}

function renderRail(over: Partial<Parameters<typeof AnalysisRail>[0]> = {}) {
  return render(
    <AnalysisRail
      contractId="contract-1"
      clauses={CLAUSES}
      findings={[ANCHORED, UNPLACED]}
      summary="A summary."
      fields={null}
      obligations={[]}
      initialMessages={[]}
      {...over}
    />,
  )
}

beforeEach(() => focusClause.mockClear())

describe('AnalysisRail', () => {
  it('opens on the risks tab and lists anchored and unplaced findings together', () => {
    renderRail()
    expect(screen.getByText('Unlimited Liability for Provider')).toBeInTheDocument()
    expect(screen.getByText('Missing Governing Law')).toBeInTheDocument()
    // The anchored one names its clause; the unplaced one says so.
    expect(screen.getByText('Clause 11')).toBeInTheDocument()
    expect(screen.getByText('reader.clauseNotPresent')).toBeInTheDocument()
  })

  it('keeps evidence hidden until a finding is expanded, then quotes the exact words', () => {
    renderRail()
    expect(screen.queryByText('Each party is capped.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Unlimited Liability/ }))

    expect(screen.getByText('reader.evidence')).toBeInTheDocument()
    // The stored verbatim quote, not the whole clause -- that is the point of
    // capturing evidence at analysis time.
    expect(screen.getByText('Each party is capped.')).toBeInTheDocument()
  })

  it('falls back to the full clause for a finding analysed before evidence was captured', () => {
    renderRail({ findings: [{ ...ANCHORED, evidence: [] }] })
    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Unlimited Liability/ }))
    expect(screen.getByText('Limitation of Liability. Each party is capped.')).toBeInTheDocument()
  })

  it('collapses an expanded finding again', () => {
    renderRail()
    const row = screen.getByRole('button', { expanded: false, name: /Unlimited Liability/ })
    fireEvent.click(row)
    expect(screen.getByText('Each party is capped.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { expanded: true, name: /Unlimited Liability/ }))
    expect(screen.queryByText('Each party is capped.')).not.toBeInTheDocument()
  })

  it('offers no evidence or jump for a finding whose clause is absent from the document', () => {
    renderRail()
    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Missing Governing Law/ }))
    expect(screen.getByText('reader.clauseNotPresentHint')).toBeInTheDocument()
    expect(screen.queryByText('reader.jumpToClause')).not.toBeInTheDocument()
  })

  it('jumps to the clause the finding is anchored to', () => {
    renderRail()
    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Unlimited Liability/ }))
    fireEvent.click(screen.getByText('reader.jumpToClause'))
    expect(focusClause).toHaveBeenCalledWith('c1')
  })

  it('shows obligations on their own tab', () => {
    renderRail({ obligations: [{ obligor: 'Customer', action: 'Pay the fee', due: '2027-06-30' }] })
    fireEvent.click(screen.getByRole('tab', { name: 'reader.tabs.obligations' }))
    expect(screen.getByText('Customer')).toBeInTheDocument()
    expect(screen.getByText('Pay the fee', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('2027-06-30')).toBeInTheDocument()
  })

  it('opens straight on chat when the contract has no analysis yet', () => {
    renderRail({ findings: [], summary: null })
    expect(screen.getByText('chat-mounted')).toBeInTheDocument()
  })
})

// A cross-clause finding is only useful if the reader can see BOTH sides of
// the relationship it claims. Showing one quote and making them hunt for the
// counterpart would put us back where the pre-rail reader was.
describe('AnalysisRail :: cross-clause findings', () => {
  it('labels a relational finding and names every clause it spans', () => {
    renderRail({ findings: [RELATIONAL] })
    expect(screen.getByText('reader.kinds.asymmetry')).toBeInTheDocument()
    expect(screen.getByText('Clause 13 · Clause 12')).toBeInTheDocument()
  })

  it('does not label an ordinary playbook finding with a kind', () => {
    renderRail({ findings: [ANCHORED] })
    expect(screen.queryByText('reader.kinds.asymmetry')).not.toBeInTheDocument()
  })

  it('shows both quotes when expanded, each under its own clause heading', () => {
    renderRail({ findings: [RELATIONAL] })
    fireEvent.click(screen.getByRole('button', { expanded: false, name: /one-sided/ }))
    expect(screen.getByText('Customer may exit at will.')).toBeInTheDocument()
    expect(screen.getByText('Customer shall indemnify.')).toBeInTheDocument()
    expect(screen.getAllByText('reader.jumpToClause')).toHaveLength(2)
  })

  it('jumps to whichever side of the relationship the reader picks', () => {
    renderRail({ findings: [RELATIONAL] })
    fireEvent.click(screen.getByRole('button', { expanded: false, name: /one-sided/ }))
    fireEvent.click(screen.getAllByText('reader.jumpToClause')[1])
    expect(focusClause).toHaveBeenCalledWith('c2')
  })

  it('ignores a span pointing at a clause no longer in the document', () => {
    renderRail({
      findings: [{ ...RELATIONAL, evidence: [...RELATIONAL.evidence, { clauseId: 'gone', quote: 'vanished text' }] }],
    })
    fireEvent.click(screen.getByRole('button', { expanded: false, name: /one-sided/ }))
    expect(screen.queryByText('vanished text')).not.toBeInTheDocument()
    expect(screen.getAllByText('reader.jumpToClause')).toHaveLength(2)
  })
})
