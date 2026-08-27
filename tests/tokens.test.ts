// tests/tokens.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/app/globals.css', 'utf8')
const TOKENS = [
  'surface', 'surface-2', 'surface-3', 'edge',
  'ink', 'ink-dim', 'ink-faint',
  'accent', 'brass',
  'risk-high', 'risk-medium', 'risk-low',
]

// The raw values live on unprefixed properties (--surface, --ink, …); the
// @theme inline block maps each to the --color-* name Tailwind generates
// utilities from. Keeping them separate is what avoids a self-referential
// declaration, which Tailwind cannot resolve.
describe('design tokens', () => {
  it('defines every raw token in the light theme', () => {
    for (const t of TOKENS) {
      expect(css).toContain(`--${t}:`)
    }
  })

  it('redefines every raw token for the dark theme', () => {
    const dark = css.slice(css.indexOf('[data-theme="dark"]'))
    for (const t of TOKENS) {
      expect(dark).toContain(`--${t}:`)
    }
  })

  it('expresses every raw colour value in oklch', () => {
    const light = css.slice(css.indexOf(':root'), css.indexOf('@media'))
    for (const t of TOKENS) {
      const decl = light.match(new RegExp(`--${t}:\\s*([^;]+);`))
      expect(decl, `--${t} missing from :root`).not.toBeNull()
      expect(decl![1]).toContain('oklch(')
    }
  })

  it('exposes every token to Tailwind through @theme inline', () => {
    const theme = css.slice(css.indexOf('@theme inline'))
    for (const t of TOKENS) {
      expect(theme).toContain(`--color-${t}: var(--${t});`)
    }
  })
})
