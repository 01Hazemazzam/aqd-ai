// tests/ui/risk-pill.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RiskPill } from '@/components/ui/risk-pill'

describe('RiskPill', () => {
  it.each([
    ['high', 'HIGH', '◆'],
    ['medium', 'MEDIUM', '▲'],
    ['low', 'LOW', '●'],
    ['none', 'NO FINDING', '✓'],
  ] as const)('renders %s with a word and a glyph', (level, word, glyph) => {
    render(<RiskPill level={level} />)
    const pill = screen.getByText(new RegExp(word))
    expect(pill).toHaveTextContent(word)
    expect(pill).toHaveTextContent(glyph)
  })
})
