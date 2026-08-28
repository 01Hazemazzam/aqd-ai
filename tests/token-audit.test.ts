// tests/token-audit.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(p) ? [p] : []
  })

const HEX = /#[0-9a-fA-F]{3,8}\b/
const RAW_COLOR = /\b(rgb|rgba|hsl|hsla|oklch)\(/

describe('token discipline', () => {
  it('confines every colour literal to globals.css', () => {
    const offenders = walk('src')
      .filter((f) => !f.endsWith('globals.css'))
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        return HEX.test(src) || RAW_COLOR.test(src)
      })
    expect(offenders).toEqual([])
  })

  it('uses no physical direction utilities', () => {
    const PHYSICAL = /\b(ml-|mr-|pl-|pr-|text-left|text-right|left-0|right-0)\b/
    const offenders = walk('src').filter((f) => PHYSICAL.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
