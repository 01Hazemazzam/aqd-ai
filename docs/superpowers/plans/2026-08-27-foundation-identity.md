# Foundation & Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design system, the multi-tenant Supabase foundation, and the complete email-and-password authentication surface including device-trust two-factor, for the Aqd AI contract-analysis platform.

**Architecture:** A single Next.js 16 App Router application on Supabase. Tenancy is enforced by Postgres Row-Level Security keyed on a JWT organisation claim, never by application code — server code always uses the user's own session client. The three operations that must legitimately cross the tenancy boundary (create organisation, accept invite, and the one-time-code/device lifecycle) are `security definer` SQL functions. All colour is OKLCH custom properties producing two themes from one token set.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4, next-intl v4, Supabase (Postgres 17, Auth, CLI for local dev), Resend for transactional email, Vitest + Testing Library, Playwright + axe-core.

**Spec:** `docs/superpowers/specs/2026-08-27-foundation-identity-design.md`

## Global Constraints

- **Server code never uses the service-role key.** Every request path uses the user's session client. Violating this defeats the entire security model.
- **No hard-coded colour outside `src/app/globals.css`.** Task 20 enforces this with an automated audit.
- **Logical CSS properties only** — `ms-`/`me-`, `ps-`/`pe-`, `text-start`, `inset-inline-start`. Never `left`/`right`/`ml-`/`mr-`.
- **No user-visible string outside `messages/en.json` and `messages/ar.json`.**
- **Arabic body line-height is 1.9; Latin is 1.7.** Set via token, never per-component.
- **Risk severity is never colour alone** — always a glyph plus a word.
- **Identity responses are uniform** in message and timing: unknown email, wrong password and unverified account are indistinguishable.
- **One-time codes:** 6 digits, 10-minute expiry, 5 attempts, then burned. Stored as SHA-256 hash. `purpose` enum is `signup_verify` or `device_challenge`, never interchangeable.
- **Rate limits:** 5 code requests per hour, per user and per IP independently.
- **Device trust:** 30 days when the box is checked; session-scoped otherwise.
- **Every task ends with a commit.** Conventional commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).

## Prerequisites (human, before Task 1)

These cannot be created by an agent. Have them ready or Task 1 stalls.

1. `git init` in the project root.
2. A Supabase account and the Supabase CLI installed (`npm i -g supabase`). Local development uses `supabase start` — no cloud project is needed until deployment.
3. Docker Desktop running (the Supabase CLI needs it).
4. A Resend account and API key (free tier) for the code emails.

## Parallelization Map

Tasks in the same lane are sequential. Lanes marked as concurrent may run simultaneously in separate agents — they touch disjoint files.

```
Task 1 (scaffold) ─── everything depends on this
     │
     ├── LANE A (frontend)     : 2 → 3 → 4 → 5
     └── LANE B (database)     : 6 → 7 → 8 → 9 → 10 → 11 → 12
                                        │
                     A and B join here ─┴── 13 → 14
                                              │
                                              ├── LANE C : 15 → 16
                                              └── LANE D : 17 → 18
                                                    │
                                       C and D join ─┴── 19 → 20
```

**Concurrency notes for the dispatcher:**
- Lanes A and B share no files. Run them in two agents from the moment Task 1 lands.
- Tasks 15/16 (signup, verify) and 17/18 (login, challenge, reset, onboarding) touch different route directories and different message keys. They may run concurrently, but **both consume `lib/auth/` from Task 14** — do not start either before 14 is merged.
- Tasks 19 and 20 are test suites over finished surface area. They are the natural place to stop parallelising.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/globals.css` | The complete OKLCH token set, both themes, base typography. The only file allowed to contain a colour literal. |
| `src/app/layout.tsx` | Root layout: html lang/dir, font links, next-intl provider. |
| `src/components/ui/*.tsx` | Design-system kit. One component per file. |
| `src/lib/supabase/client.ts` | Browser Supabase client. |
| `src/lib/supabase/server.ts` | Server session client (cookie-bound). |
| `src/lib/auth/device.ts` | Device cookie read/write and secret generation. |
| `src/lib/auth/codes.ts` | `issueCode`, `verifyCode` — thin wrappers over the SQL definers. |
| `src/lib/auth/guards.ts` | `requireSession`, `requireVerified`. |
| `src/lib/auth/email.ts` | Resend transport and the code email template. |
| `src/lib/i18n/*.ts` | Locale cookie, request config, direction resolution. |
| `messages/{en,ar}.json` | Every user-visible string. |
| `supabase/migrations/*.sql` | Schema, RLS, JWT hook, security-definer functions. |
| `src/app/(auth)/*` | Signup, verify, login, challenge, reset screens. |
| `src/app/(app)/layout.tsx` | The verified-session guard. |
| `src/app/onboarding/page.tsx` | Create organisation / accept invite. |
| `tests/` | Vitest integration tests. |
| `e2e/` | Playwright visual and accessibility tests. |

---

## Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `.env.example`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable `npm test` (Vitest), `npm run e2e` (Playwright), `npm run dev` (Next.js). Every later task depends on these three commands.

- [ ] **Step 1: Scaffold the app**

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --no-eslint --import-alias "@/*"
```

Answer "No" to Turbopack prompts if asked; defaults are fine otherwise.

- [ ] **Step 2: Install test and runtime dependencies**

```bash
npm i @supabase/supabase-js @supabase/ssr next-intl resend
npm i -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom @playwright/test @axe-core/playwright
npx playwright install chromium
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
```

- [ ] **Step 4: Write `tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 5: Write the failing smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest'
import { appName } from '@/lib/constants'

describe('scaffold', () => {
  it('exposes the app name', () => {
    expect(appName).toBe('Aqd AI')
  })
})
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run tests/smoke.test.ts`
Expected: FAIL — cannot resolve `@/lib/constants`.

- [ ] **Step 7: Create the module**

```ts
// src/lib/constants.ts
export const appName = 'Aqd AI'
```

- [ ] **Step 8: Run it and confirm it passes**

Run: `npx vitest run tests/smoke.test.ts`
Expected: PASS.

- [ ] **Step 9: Add scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  }
}
```

- [ ] **Step 10: Write `.env.example`**

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
RESEND_API_KEY=
EMAIL_FROM="Aqd AI <auth@example.com>"
DEVICE_COOKIE_NAME=aqd_device
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest and Playwright"
```

---

## Task 2: The OKLCH token system and both themes

> **LANE A start.** Runs concurrently with Task 6.

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/components/theme-provider.tsx`
- Test: `tests/tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--color-surface`, `--color-surface-2`, `--color-surface-3`, `--color-edge`, `--color-ink`, `--color-ink-dim`, `--color-ink-faint`, `--color-accent`, `--color-brass`, `--color-risk-high`, `--color-risk-medium`, `--color-risk-low`, plus `--leading-latin` and `--leading-arabic`. Every later component reads these and nothing else.

- [ ] **Step 1: Write the failing token test**

```ts
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

describe('design tokens', () => {
  it('defines every token in the light theme', () => {
    for (const t of TOKENS) {
      expect(css).toContain(`--color-${t}:`)
    }
  })

  it('redefines every token for the dark theme', () => {
    const dark = css.slice(css.indexOf('[data-theme="dark"]'))
    for (const t of TOKENS) {
      expect(dark).toContain(`--color-${t}:`)
    }
  })

  it('expresses every colour in oklch', () => {
    const decls = css.match(/--color-[a-z-]+:\s*([^;]+);/g) ?? []
    expect(decls.length).toBeGreaterThan(0)
    for (const d of decls) {
      expect(d).toContain('oklch(')
    }
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/tokens.test.ts`
Expected: FAIL — no `--color-surface` in the file.

- [ ] **Step 3: Write `src/app/globals.css`**

```css
@import "tailwindcss";

:root {
  --color-surface:     oklch(97% .008 85);
  --color-surface-2:   oklch(99% .005 85);
  --color-surface-3:   oklch(95% .011 85);
  --color-edge:        oklch(89% .014 85);
  --color-ink:         oklch(21% .006 75);
  --color-ink-dim:     oklch(43% .012 80);
  --color-ink-faint:   oklch(60% .013 80);
  --color-accent:      oklch(44% .068 165);
  --color-brass:       oklch(52% .069 78);
  --color-risk-high:   oklch(53% .148 18);
  --color-risk-medium: oklch(60% .112 70);
  --color-risk-low:    oklch(53% .062 160);

  --leading-latin: 1.7;
  --leading-arabic: 1.9;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-surface:     oklch(17% .017 250);
    --color-surface-2:   oklch(20% .019 250);
    --color-surface-3:   oklch(22% .020 250);
    --color-edge:        oklch(28% .021 250);
    --color-ink:         oklch(94% .008 250);
    --color-ink-dim:     oklch(70% .028 250);
    --color-ink-faint:   oklch(58% .031 250);
    --color-accent:      oklch(78% .095 178);
    --color-brass:       oklch(72% .118 88);
    --color-risk-high:   oklch(75% .134 18);
    --color-risk-medium: oklch(82% .108 82);
    --color-risk-low:    oklch(80% .085 160);
  }
}

:root[data-theme="dark"] {
  --color-surface:     oklch(17% .017 250);
  --color-surface-2:   oklch(20% .019 250);
  --color-surface-3:   oklch(22% .020 250);
  --color-edge:        oklch(28% .021 250);
  --color-ink:         oklch(94% .008 250);
  --color-ink-dim:     oklch(70% .028 250);
  --color-ink-faint:   oklch(58% .031 250);
  --color-accent:      oklch(78% .095 178);
  --color-brass:       oklch(72% .118 88);
  --color-risk-high:   oklch(75% .134 18);
  --color-risk-medium: oklch(82% .108 82);
  --color-risk-low:    oklch(80% .085 160);
}

@theme inline {
  --color-surface:     var(--color-surface);
  --color-surface-2:   var(--color-surface-2);
  --color-surface-3:   var(--color-surface-3);
  --color-edge:        var(--color-edge);
  --color-ink:         var(--color-ink);
  --color-ink-dim:     var(--color-ink-dim);
  --color-ink-faint:   var(--color-ink-faint);
  --color-accent:      var(--color-accent);
  --color-brass:       var(--color-brass);
  --color-risk-high:   var(--color-risk-high);
  --color-risk-medium: var(--color-risk-medium);
  --color-risk-low:    var(--color-risk-low);
}

html { background: var(--color-surface); color: var(--color-ink); }
body { line-height: var(--leading-latin); }
html[dir="rtl"] body { line-height: var(--leading-arabic); }

:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/tokens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the theme provider**

```tsx
// src/components/theme-provider.tsx
'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'
const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: 'system',
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const stored = window.localStorage.getItem('theme') as Theme | null
    if (stored) setTheme(stored)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    window.localStorage.setItem('theme', theme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
```

- [ ] **Step 6: Wire fonts and the provider into `src/app/layout.tsx`**

```tsx
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Inter:wght@400;500;600;700&family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap"
        />
      </head>
      <body className="bg-surface text-ink antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add OKLCH token system with light and dark themes"
```

---

## Task 3: UI kit — Button, Input, Card, Badge, Spinner

**Files:**
- Create: `src/components/ui/button.tsx`, `input.tsx`, `card.tsx`, `badge.tsx`, `spinner.tsx`, `cn.ts`
- Test: `tests/ui/button.test.tsx`, `tests/ui/input.test.tsx`

**Interfaces:**
- Consumes: tokens from Task 2.
- Produces:
  - `Button({ variant?: 'primary' | 'secondary' | 'ghost' | 'danger', loading?: boolean, ...ButtonHTMLAttributes })`
  - `Input({ label: string, error?: string, hint?: string, ...InputHTMLAttributes })`
  - `Card({ children })`, `Badge({ children, tone?: 'neutral' | 'accent' | 'brass' })`, `Spinner({ size?: number })`

- [ ] **Step 1: Write the failing Button test**

```tsx
// tests/ui/button.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>Sign in</Button>)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('is disabled and busy while loading', () => {
    render(<Button loading>Sign in</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/ui/button.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/components/ui/cn.ts`**

```ts
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}
```

- [ ] **Step 4: Write `src/components/ui/button.tsx`**

```tsx
import { cn } from './cn'
import { Spinner } from './spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-surface-2 hover:opacity-90',
  secondary: 'bg-surface-2 text-ink border border-edge hover:bg-surface-3',
  ghost: 'bg-transparent text-ink-dim hover:bg-surface-3',
  danger: 'bg-transparent text-risk-high border border-risk-high hover:bg-surface-3',
}

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2',
        'text-sm font-semibold transition-opacity disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  )
}
```

- [ ] **Step 5: Write `src/components/ui/spinner.tsx`**

```tsx
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size }}
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}
```

- [ ] **Step 6: Run the Button test and confirm it passes**

Run: `npx vitest run tests/ui/button.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Write the failing Input test**

```tsx
// tests/ui/input.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Input } from '@/components/ui/input'

describe('Input', () => {
  it('associates the label with the control', () => {
    render(<Input label="Email" name="email" />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('announces an error and marks the field invalid', () => {
    render(<Input label="Email" name="email" error="Enter a valid email address" />)
    const field = screen.getByLabelText('Email')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address')
  })
})
```

- [ ] **Step 8: Run and confirm failure**

Run: `npx vitest run tests/ui/input.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 9: Write `src/components/ui/input.tsx`**

```tsx
import { useId } from 'react'
import { cn } from './cn'

export function Input({
  label,
  error,
  hint,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={cn(error && errorId, hint && hintId) || undefined}
        className={cn(
          'rounded-lg border bg-surface-2 px-3 py-2 text-sm text-ink',
          'placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-accent',
          error ? 'border-risk-high' : 'border-edge',
          className,
        )}
      />
      {hint && !error && (
        <span id={hintId} className="text-xs text-ink-faint">{hint}</span>
      )}
      {error && (
        <span id={errorId} role="alert" className="text-xs text-risk-high">{error}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 10: Write `src/components/ui/card.tsx` and `badge.tsx`**

```tsx
// card.tsx
import { cn } from './cn'
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-xl border border-edge bg-surface-2 p-6', className)}>{children}</div>
}
```

```tsx
// badge.tsx
import { cn } from './cn'
const TONES = {
  neutral: 'bg-surface-3 text-ink-dim',
  accent: 'bg-surface-3 text-accent',
  brass: 'bg-surface-3 text-brass',
} as const
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone])}>{children}</span>
}
```

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add core UI kit components"
```

---

## Task 4: Verification code input and risk severity pills

**Files:**
- Create: `src/components/ui/code-input.tsx`, `src/components/ui/risk-pill.tsx`
- Test: `tests/ui/code-input.test.tsx`, `tests/ui/risk-pill.test.tsx`

**Interfaces:**
- Consumes: tokens from Task 2, `cn` from Task 3.
- Produces:
  - `CodeInput({ length?: number, value: string, onChange: (v: string) => void, error?: string, label: string })` — the six-box control used by Tasks 15 and 17.
  - `RiskPill({ level: 'high' | 'medium' | 'low' | 'none' })`

- [ ] **Step 1: Write the failing CodeInput test**

```tsx
// tests/ui/code-input.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodeInput } from '@/components/ui/code-input'

describe('CodeInput', () => {
  it('renders one box per digit', () => {
    render(<CodeInput label="Verification code" value="" onChange={() => {}} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
  })

  it('reports the full value as digits are typed', () => {
    const onChange = vi.fn()
    render(<CodeInput label="Verification code" value="49" onChange={onChange} />)
    fireEvent.change(screen.getAllByRole('textbox')[2], { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith('492')
  })

  it('accepts a pasted code', () => {
    const onChange = vi.fn()
    render(<CodeInput label="Verification code" value="" onChange={onChange} />)
    fireEvent.paste(screen.getAllByRole('textbox')[0], {
      clipboardData: { getData: () => '492817' },
    })
    expect(onChange).toHaveBeenCalledWith('492817')
  })

  it('ignores non-digits', () => {
    const onChange = vi.fn()
    render(<CodeInput label="Verification code" value="" onChange={onChange} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'a' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/ui/code-input.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/components/ui/code-input.tsx`**

```tsx
'use client'
import { useRef, useId } from 'react'
import { cn } from './cn'

export function CodeInput({
  length = 6,
  value,
  onChange,
  error,
  label,
}: {
  length?: number
  value: string
  onChange: (v: string) => void
  error?: string
  label: string
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const id = useId()
  const errorId = `${id}-error`

  const setDigit = (index: number, digit: string) => {
    if (digit && !/^\d$/.test(digit)) return
    const next = value.padEnd(length, ' ').split('')
    next[index] = digit
    onChange(next.join('').trimEnd())
    if (digit && index < length - 1) refs.current[index + 1]?.focus()
  }

  const onKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) refs.current[index - 1]?.focus()
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (!pasted) return
    e.preventDefault()
    onChange(pasted)
    refs.current[Math.min(pasted.length, length - 1)]?.focus()
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex gap-2" role="group" aria-label={label}>
        {Array.from({ length }, (_, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            value={value[i] ?? ''}
            aria-label={`Digit ${i + 1}`}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={onKeyDown(i)}
            onPaste={onPaste}
            className={cn(
              'h-12 w-10 rounded-lg border bg-surface-2 text-center text-lg font-semibold text-ink',
              'tabular-nums focus-visible:outline-2 focus-visible:outline-accent',
              error ? 'border-risk-high' : value[i] ? 'border-brass' : 'border-edge',
            )}
          />
        ))}
      </div>
      {error && <span id={errorId} role="alert" className="text-xs text-risk-high">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/ui/code-input.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing RiskPill test**

```tsx
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
```

- [ ] **Step 6: Run and confirm failure**

Run: `npx vitest run tests/ui/risk-pill.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Write `src/components/ui/risk-pill.tsx`**

```tsx
import { cn } from './cn'

const LEVELS = {
  high: { glyph: '◆', word: 'HIGH', className: 'text-risk-high' },
  medium: { glyph: '▲', word: 'MEDIUM', className: 'text-risk-medium' },
  low: { glyph: '●', word: 'LOW', className: 'text-risk-low' },
  none: { glyph: '✓', word: 'NO FINDING', className: 'text-ink-dim' },
} as const

export function RiskPill({ level }: { level: keyof typeof LEVELS }) {
  const { glyph, word, className } = LEVELS[level]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-0.5', 'text-xs font-bold tracking-wide', className)}>
      <span aria-hidden="true">{glyph}</span>
      {word}
    </span>
  )
}
```

Severity is never colour alone — the glyph and the word are both required, which is exactly what the test asserts.

- [ ] **Step 8: Run and confirm it passes**

Run: `npx vitest run tests/ui/risk-pill.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 9: Add Tabs and the clause row**

The spec lists both as part of the kit. Neither is used by an auth screen — they exist so sub-project 2's contract workspace inherits a finished kit rather than inventing components mid-feature.

```tsx
// src/components/ui/tabs.tsx
'use client'
import { cn } from './cn'

export function Tabs({ tabs, active, onChange }: {
  tabs: Array<{ id: string; label: string }>
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-edge">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm',
            tab.id === active
              ? 'border-accent font-semibold text-ink'
              : 'border-transparent text-ink-dim hover:text-ink',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
```

```tsx
// src/components/ui/clause-row.tsx
import { cn } from './cn'
import { RiskPill } from './risk-pill'

const GUTTER = {
  high: 'bg-risk-high',
  medium: 'bg-risk-medium',
  low: 'bg-risk-low',
  none: 'bg-transparent',
} as const

export function ClauseRow({ number, heading, body, severity = 'none', dir }: {
  number: string
  heading: string
  body: string
  severity?: keyof typeof GUTTER
  dir?: 'ltr' | 'rtl'
}) {
  return (
    <article dir={dir} className="relative flex gap-3 rounded-xl border border-edge bg-surface-2 p-4">
      {/* Logical inset, so the gutter mirrors in RTL with no second rule. */}
      <span aria-hidden="true" className={cn('absolute inset-inline-start-0 top-4 bottom-4 w-[3px] rounded-full', GUTTER[severity])} />
      <span className="font-serif text-lg font-semibold leading-none text-brass">{number}</span>
      <div className="flex-1">
        <h3 className="mb-1 text-sm font-semibold text-ink">{heading}</h3>
        <p className="text-sm text-ink-dim">{body}</p>
      </div>
      {severity !== 'none' && <RiskPill level={severity} />}
    </article>
  )
}
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add verification code input, risk pills, tabs and clause row"
```

---

## Task 5: Internationalisation and RTL

**Files:**
- Create: `src/lib/i18n/config.ts`, `src/lib/i18n/request.ts`, `messages/en.json`, `messages/ar.json`
- Modify: `src/app/layout.tsx`, `next.config.ts`
- Create: `src/app/actions/locale.ts`
- Test: `tests/i18n.test.ts`

**Interfaces:**
- Produces: `getLocale(): Promise<'en' | 'ar'>`, `dirFor(locale): 'ltr' | 'rtl'`, `setLocale(locale)` server action. Every later screen reads strings via next-intl's `useTranslations`.

- [ ] **Step 1: Write the failing i18n test**

```ts
// tests/i18n.test.ts
import { describe, it, expect } from 'vitest'
import { dirFor, LOCALES } from '@/lib/i18n/config'
import en from '../messages/en.json'
import ar from '../messages/ar.json'

const keys = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  )

describe('i18n', () => {
  it('resolves direction per locale', () => {
    expect(dirFor('en')).toBe('ltr')
    expect(dirFor('ar')).toBe('rtl')
  })

  it('supports exactly English and Arabic', () => {
    expect(LOCALES).toEqual(['en', 'ar'])
  })

  it('has identical key sets in both message files', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort())
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/i18n.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/i18n/config.ts`**

```ts
export const LOCALES = ['en', 'ar'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'aqd_locale'

export function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Write `src/lib/i18n/request.ts`**

```ts
import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from './config'

export default getRequestConfig(async () => {
  const store = await cookies()
  const raw = store.get(LOCALE_COOKIE)?.value
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  return { locale, messages: (await import(`../../../messages/${locale}.json`)).default }
})
```

- [ ] **Step 5: Write `messages/en.json`**

```json
{
  "auth": {
    "signup": {
      "title": "Create your account",
      "subtitle": "Analyze contracts in Arabic and English.",
      "email": "Email",
      "password": "Password",
      "submit": "Create account",
      "haveAccount": "Already have an account?",
      "signIn": "Sign in"
    },
    "verify": {
      "title": "Check your email",
      "subtitle": "We sent a 6-digit code to {email}.",
      "code": "Verification code",
      "submit": "Verify",
      "resend": "Resend code",
      "resendIn": "Resend in {seconds}s",
      "sendFailed": "We couldn't send the code. Try resending in a moment."
    },
    "login": {
      "title": "Sign in",
      "subtitle": "Welcome back.",
      "email": "Email",
      "password": "Password",
      "submit": "Sign in",
      "forgot": "Forgot your password?",
      "noAccount": "No account yet?",
      "signUp": "Create one"
    },
    "challenge": {
      "title": "Verify this device",
      "subtitle": "This is a new device, so we emailed you a 6-digit code.",
      "code": "Verification code",
      "trust": "Trust this device for 30 days",
      "submit": "Continue"
    },
    "reset": {
      "title": "Reset your password",
      "subtitle": "We'll email you a code to set a new password.",
      "email": "Email",
      "newPassword": "New password",
      "submit": "Send code",
      "confirm": "Set new password",
      "done": "Password changed. All trusted devices were signed out."
    },
    "errors": {
      "invalidCredentials": "That email and password combination isn't right.",
      "invalidEmail": "Enter a valid email address.",
      "weakPassword": "Use at least 10 characters.",
      "codeIncorrect": "That code isn't right. {remaining} attempts left.",
      "codeExpired": "That code has expired. Request a new one.",
      "codeBurned": "Too many attempts. Request a new code.",
      "rateLimited": "Too many requests. Try again in an hour."
    }
  },
  "onboarding": {
    "title": "Create your organization",
    "subtitle": "Contracts, members and analysis all live inside an organization.",
    "name": "Organization name",
    "submit": "Create organization",
    "inviteTitle": "You've been invited",
    "inviteBody": "{org} invited you to join as {role}.",
    "acceptInvite": "Accept invitation"
  },
  "common": {
    "appName": "Aqd AI",
    "loading": "Loading",
    "theme": "Theme",
    "language": "Language"
  }
}
```

- [ ] **Step 6: Write `messages/ar.json`**

The key set must match `en.json` exactly — the test asserts it.

```json
{
  "auth": {
    "signup": {
      "title": "أنشئ حسابك",
      "subtitle": "حلّل العقود بالعربية والإنجليزية.",
      "email": "البريد الإلكتروني",
      "password": "كلمة المرور",
      "submit": "إنشاء الحساب",
      "haveAccount": "لديك حساب بالفعل؟",
      "signIn": "تسجيل الدخول"
    },
    "verify": {
      "title": "تحقّق من بريدك",
      "subtitle": "أرسلنا رمزاً من ٦ أرقام إلى {email}.",
      "code": "رمز التحقق",
      "submit": "تحقّق",
      "resend": "إعادة إرسال الرمز",
      "resendIn": "إعادة الإرسال خلال {seconds} ثانية",
      "sendFailed": "تعذّر إرسال الرمز. حاول إعادة الإرسال بعد قليل."
    },
    "login": {
      "title": "تسجيل الدخول",
      "subtitle": "أهلاً بعودتك.",
      "email": "البريد الإلكتروني",
      "password": "كلمة المرور",
      "submit": "تسجيل الدخول",
      "forgot": "نسيت كلمة المرور؟",
      "noAccount": "ليس لديك حساب؟",
      "signUp": "أنشئ حساباً"
    },
    "challenge": {
      "title": "تحقّق من هذا الجهاز",
      "subtitle": "هذا جهاز جديد، لذلك أرسلنا إليك رمزاً من ٦ أرقام.",
      "code": "رمز التحقق",
      "trust": "الوثوق بهذا الجهاز لمدة ٣٠ يوماً",
      "submit": "متابعة"
    },
    "reset": {
      "title": "إعادة تعيين كلمة المرور",
      "subtitle": "سنرسل إليك رمزاً لتعيين كلمة مرور جديدة.",
      "email": "البريد الإلكتروني",
      "newPassword": "كلمة المرور الجديدة",
      "submit": "إرسال الرمز",
      "confirm": "تعيين كلمة المرور",
      "done": "تم تغيير كلمة المرور. تم تسجيل الخروج من جميع الأجهزة الموثوقة."
    },
    "errors": {
      "invalidCredentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
      "invalidEmail": "أدخل بريداً إلكترونياً صالحاً.",
      "weakPassword": "استخدم ١٠ أحرف على الأقل.",
      "codeIncorrect": "الرمز غير صحيح. تبقّت {remaining} محاولات.",
      "codeExpired": "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
      "codeBurned": "محاولات كثيرة. اطلب رمزاً جديداً.",
      "rateLimited": "طلبات كثيرة. حاول بعد ساعة."
    }
  },
  "onboarding": {
    "title": "أنشئ مؤسستك",
    "subtitle": "العقود والأعضاء والتحليلات كلها ضمن المؤسسة.",
    "name": "اسم المؤسسة",
    "submit": "إنشاء المؤسسة",
    "inviteTitle": "لقد تمت دعوتك",
    "inviteBody": "دعتك {org} للانضمام بصفة {role}.",
    "acceptInvite": "قبول الدعوة"
  },
  "common": {
    "appName": "عقد",
    "loading": "جارٍ التحميل",
    "theme": "المظهر",
    "language": "اللغة"
  }
}
```

- [ ] **Step 7: Run and confirm it passes**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Write the locale server action**

```ts
// src/app/actions/locale.ts
'use server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n/config'

export async function setLocale(locale: Locale) {
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  revalidatePath('/')
}
```

- [ ] **Step 9: Wire next-intl into `next.config.ts` and the root layout**

```ts
// next.config.ts
import createNextIntlPlugin from 'next-intl/plugin'
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts')
export default withNextIntl({})
```

In `src/app/layout.tsx`, replace the hard-coded `lang`/`dir` and wrap children:

```tsx
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { dirFor, type Locale } from '@/lib/i18n/config'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await getLocale()) as Locale
  const messages = await getMessages()
  return (
    <html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
      {/* head unchanged */}
      <body className="bg-surface text-ink antialiased">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add bilingual i18n with automatic RTL"
```

---

## Task 6: Supabase local and the tenancy schema

> **LANE B start.** Runs concurrently with Task 2.

**Files:**
- Create: `supabase/config.toml` (generated), `supabase/migrations/0001_tenancy.sql`
- Test: `tests/db/tenancy.test.ts`

**Interfaces:**
- Produces: tables `organizations`, `org_members`, `invites` with RLS enabled. Task 7 adds the claim helpers those policies call.

- [ ] **Step 1: Initialise and start Supabase**

```bash
npx supabase init
npx supabase start
```

Record the printed API URL, anon key and database URL into `.env.local`.

- [ ] **Step 2: Write the failing tenancy test**

```ts
// tests/db/tenancy.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client

beforeAll(async () => {
  db = new Client({ connectionString: DB })
  await db.connect()
})

describe('tenancy schema', () => {
  it('creates the three tenancy tables', async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1)`,
      [['organizations', 'org_members', 'invites']],
    )
    expect(rows.map((r) => r.table_name).sort()).toEqual(['invites', 'org_members', 'organizations'])
  })

  it('enables row level security on all of them', async () => {
    const { rows } = await db.query(
      `select relname, relrowsecurity from pg_class
       where relname = any($1)`,
      [['organizations', 'org_members', 'invites']],
    )
    for (const r of rows) expect(r.relrowsecurity).toBe(true)
  })

  it('stores invite tokens hashed, never in plaintext', async () => {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
       where table_name = 'invites'`,
    )
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain('token_hash')
    expect(cols).not.toContain('token')
  })
})
```

Install the driver: `npm i -D pg @types/pg`

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run tests/db/tenancy.test.ts`
Expected: FAIL — tables do not exist.

- [ ] **Step 4: Write `supabase/migrations/0001_tenancy.sql`**

```sql
create extension if not exists pgcrypto;

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 2 and 120),
  slug       text not null unique,
  created_at timestamptz not null default now()
);

create type public.org_role as enum ('owner', 'admin', 'member');

create table public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on public.org_members (user_id);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       citext not null,
  role        public.org_role not null default 'member',
  token_hash  bytea not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create index invites_email_idx on public.invites (email) where accepted_at is null;

alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;
alter table public.invites       enable row level security;
```

`citext` needs enabling — add `create extension if not exists citext;` above the `invites` table.

- [ ] **Step 5: Apply the migration**

```bash
npx supabase migration up
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npx vitest run tests/db/tenancy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add tenancy schema with row level security"
```

---

## Task 7: JWT organisation claims and the membership fallback

**Files:**
- Create: `supabase/migrations/0002_jwt_claims.sql`
- Test: `tests/db/claims.test.ts`

**Interfaces:**
- Consumes: `org_members` from Task 6.
- Produces: `public.custom_access_token_hook(jsonb) returns jsonb`, `public.jwt_org_id() returns uuid`, `public.jwt_org_role() returns public.org_role`. Every RLS policy from here on calls `jwt_org_id()`.

- [ ] **Step 1: Write the failing claims test**

```ts
// tests/db/claims.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client
let userId: string
let orgId: string

beforeAll(async () => {
  db = new Client({ connectionString: DB })
  await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'claims@test.local', '', now(), now())
     returning id`,
  )
  userId = u.rows[0].id
  const o = await db.query(
    `insert into public.organizations (name, slug) values ('Claims Org', 'claims-org') returning id`,
  )
  orgId = o.rows[0].id
  await db.query(`insert into public.org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [orgId, userId])
})

afterAll(async () => {
  await db.query(`delete from auth.users where id = $1`, [userId])
  await db.end()
})

describe('jwt claims', () => {
  it('stamps org_id and org_role into the token', async () => {
    const { rows } = await db.query(
      `select public.custom_access_token_hook(
         jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)
       ) as event`,
      [userId],
    )
    expect(rows[0].event.claims.org_id).toBe(orgId)
    expect(rows[0].event.claims.org_role).toBe('owner')
  })

  it('falls back to the membership table when the claim is absent', async () => {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId }),
    ])
    const { rows } = await db.query(`select public.jwt_org_id() as org_id`)
    expect(rows[0].org_id).toBe(orgId)
  })

  it('prefers the claim over the fallback when both exist', async () => {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, org_id: orgId }),
    ])
    const { rows } = await db.query(`select public.jwt_org_id() as org_id`)
    expect(rows[0].org_id).toBe(orgId)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/db/claims.test.ts`
Expected: FAIL — function `custom_access_token_hook` does not exist.

- [ ] **Step 3: Write `supabase/migrations/0002_jwt_claims.sql`**

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  membership record;
  claims jsonb;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  select org_id, role into membership
  from public.org_members
  where user_id = (event ->> 'user_id')::uuid
  order by created_at asc
  limit 1;

  if membership.org_id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(membership.org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(membership.role::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Reads the org from the JWT, falling back to the membership table.
-- The fallback matters: a token minted before the user joined an organisation
-- carries no claim, and without it that user is locked out of their own data.
create or replace function public.jwt_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_id', '')::uuid,
    (select org_id from public.org_members
      where user_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
      order by created_at asc limit 1)
  );
$$;

create or replace function public.jwt_org_role()
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_role', '')::public.org_role,
    (select role from public.org_members
      where user_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
      order by created_at asc limit 1)
  );
$$;
```

- [ ] **Step 4: Add the RLS policies that use them**

Append to the same migration:

```sql
create policy org_read on public.organizations
  for select using (id = public.jwt_org_id());

create policy members_read on public.org_members
  for select using (org_id = public.jwt_org_id());

create policy members_admin_write on public.org_members
  for all using (org_id = public.jwt_org_id() and public.jwt_org_role() in ('owner', 'admin'))
  with check (org_id = public.jwt_org_id() and public.jwt_org_role() in ('owner', 'admin'));

create policy invites_read on public.invites
  for select using (org_id = public.jwt_org_id());

create policy invites_admin_write on public.invites
  for all using (org_id = public.jwt_org_id() and public.jwt_org_role() in ('owner', 'admin'))
  with check (org_id = public.jwt_org_id() and public.jwt_org_role() in ('owner', 'admin'));
```

- [ ] **Step 5: Enable the hook in `supabase/config.toml`**

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

Restart: `npx supabase stop && npx supabase start`

- [ ] **Step 6: Apply and run the test**

```bash
npx supabase migration up
npx vitest run tests/db/claims.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: stamp org claims into the JWT with a membership fallback"
```

---

## Task 8: Identity tables — devices, codes, rate limits, audit

**Files:**
- Create: `supabase/migrations/0003_identity.sql`
- Test: `tests/db/identity.test.ts`

**Interfaces:**
- Produces: tables `trusted_devices`, `login_codes`, `rate_limits`, `auth_events`, and the enum `public.code_purpose` (`signup_verify` | `device_challenge`). Task 10 writes the functions that operate on them.

- [ ] **Step 1: Write the failing identity test**

```ts
// tests/db/identity.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client

beforeAll(async () => { db = new Client({ connectionString: DB }); await db.connect() })
afterAll(async () => { await db.end() })

describe('identity schema', () => {
  it('creates the identity tables', async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1)`,
      [['trusted_devices', 'login_codes', 'rate_limits', 'auth_events']],
    )
    expect(rows).toHaveLength(4)
  })

  it('defines the code purpose enum with exactly two values', async () => {
    const { rows } = await db.query(
      `select enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid where t.typname = 'code_purpose'
       order by enumlabel`,
    )
    expect(rows.map((r) => r.enumlabel)).toEqual(['device_challenge', 'signup_verify'])
  })

  it('grants SELECT on login_codes to nobody', async () => {
    const { rows } = await db.query(
      `select polcmd from pg_policy p
       join pg_class c on c.oid = p.polrelid
       where c.relname = 'login_codes' and p.polcmd = 'r'`,
    )
    expect(rows).toHaveLength(0)
  })

  it('stores only hashes, never a plaintext code or device secret', async () => {
    const { rows } = await db.query(
      `select table_name, column_name from information_schema.columns
       where table_name in ('login_codes', 'trusted_devices')`,
    )
    const cols = rows.map((r) => `${r.table_name}.${r.column_name}`)
    expect(cols).toContain('login_codes.code_hash')
    expect(cols).toContain('trusted_devices.device_hash')
    expect(cols).not.toContain('login_codes.code')
    expect(cols).not.toContain('trusted_devices.device_secret')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/db/identity.test.ts`
Expected: FAIL — tables do not exist.

- [ ] **Step 3: Write `supabase/migrations/0003_identity.sql`**

```sql
create type public.code_purpose as enum ('signup_verify', 'device_challenge');

create table public.login_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  code_hash     bytea not null,
  purpose       public.code_purpose not null,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  attempt_count int not null default 0,
  created_at    timestamptz not null default now()
);

create index login_codes_live_idx
  on public.login_codes (user_id, purpose)
  where consumed_at is null;

create table public.trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_hash  bytea not null,
  label        text,
  user_agent   text,
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, device_hash)
);

create index trusted_devices_live_idx
  on public.trusted_devices (user_id)
  where revoked_at is null;

create table public.rate_limits (
  subject      text not null,
  action       text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (subject, action, window_start)
);

create table public.auth_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null default auth.uid(),
  org_id     uuid references public.organizations(id) on delete set null,
  kind       text not null,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index auth_events_user_idx on public.auth_events (user_id, created_at desc);

alter table public.login_codes     enable row level security;
alter table public.trusted_devices enable row level security;
alter table public.rate_limits     enable row level security;
alter table public.auth_events     enable row level security;

-- login_codes deliberately has NO policy at all. Every access goes through a
-- security definer function, so a user cannot read their own code hash even
-- with a valid session and an arbitrary query.

create policy devices_own_read on public.trusted_devices
  for select using (user_id = auth.uid());

create policy devices_own_revoke on public.trusted_devices
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy events_own_read on public.auth_events
  for select using (user_id = auth.uid());

-- The app records its own security events (a failed code send, for instance).
-- A user may write events attributed to themselves and read them back; they
-- can never write one attributed to somebody else.
create policy events_own_insert on public.auth_events
  for insert with check (user_id = auth.uid());

-- rate_limits has no policy either; only definer functions touch it.
```

- [ ] **Step 4: Apply and run the test**

```bash
npx supabase migration up
npx vitest run tests/db/identity.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add device, code, rate limit and audit tables"
```

---

## Task 9: Organisation lifecycle functions

**Files:**
- Create: `supabase/migrations/0004_org_functions.sql`
- Test: `tests/db/org-functions.test.ts`

**Interfaces:**
- Consumes: Tasks 6 and 7.
- Produces: `public.create_organization(p_name text) returns uuid`, `public.accept_invite(p_token text) returns uuid`. Task 18's onboarding screen calls both.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/org-functions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHash, randomBytes } from 'node:crypto'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client
let userId: string

const asUser = async (id: string) =>
  db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id })])

beforeAll(async () => {
  db = new Client({ connectionString: DB }); await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'orgfn@test.local', '', now(), now()) returning id`,
  )
  userId = u.rows[0].id
})

afterAll(async () => { await db.query(`delete from auth.users where id = $1`, [userId]); await db.end() })

describe('create_organization', () => {
  it('creates the org and makes the caller its owner', async () => {
    await asUser(userId)
    const { rows } = await db.query(`select public.create_organization('Kuwait Legal') as org_id`)
    const orgId = rows[0].org_id
    const m = await db.query(
      `select role from public.org_members where org_id = $1 and user_id = $2`, [orgId, userId],
    )
    expect(m.rows[0].role).toBe('owner')
  })

  it('generates a unique slug when names collide', async () => {
    await asUser(userId)
    await db.query(`select public.create_organization('Kuwait Legal')`)
    const { rows } = await db.query(`select slug from public.organizations where name = 'Kuwait Legal'`)
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length)
  })
})

describe('accept_invite', () => {
  it('joins the org and burns the invite', async () => {
    const token = randomBytes(24).toString('base64url')
    const hash = createHash('sha256').update(token).digest()
    await asUser(userId)
    const { rows: o } = await db.query(`select public.create_organization('Inviting Co') as org_id`)
    await db.query(
      `insert into public.invites (org_id, email, role, token_hash, expires_at)
       values ($1, 'orgfn@test.local', 'member', $2, now() + interval '7 days')`,
      [o.rows[0].org_id, hash],
    )
    const { rows } = await db.query(`select public.accept_invite($1) as org_id`, [token])
    expect(rows[0].org_id).toBe(o.rows[0].org_id)
    const inv = await db.query(`select accepted_at from public.invites where token_hash = $1`, [hash])
    expect(inv.rows[0].accepted_at).not.toBeNull()
  })

  it('refuses an expired invite', async () => {
    const token = randomBytes(24).toString('base64url')
    const hash = createHash('sha256').update(token).digest()
    await asUser(userId)
    const { rows: o } = await db.query(`select public.create_organization('Expired Co') as org_id`)
    await db.query(
      `insert into public.invites (org_id, email, role, token_hash, expires_at)
       values ($1, 'orgfn@test.local', 'member', $2, now() - interval '1 day')`,
      [o.rows[0].org_id, hash],
    )
    await expect(db.query(`select public.accept_invite($1)`, [token])).rejects.toThrow(/invite_invalid/)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/db/org-functions.test.ts`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Write `supabase/migrations/0004_org_functions.sql`**

```sql
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_base text;
  v_slug text;
  v_org  uuid;
  v_n    int := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  v_base := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'org'; end if;
  v_slug := v_base;

  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;

  insert into public.organizations (name, slug) values (trim(p_name), v_slug) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_user, 'owner');
  insert into public.auth_events (user_id, org_id, kind) values (v_user, v_org, 'org_created');

  return v_org;
end;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_email  citext;
  v_invite record;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select email into v_email from auth.users where id = v_user;

  select * into v_invite
  from public.invites
  where token_hash = digest(p_token, 'sha256')
    and accepted_at is null
    and expires_at > now()
    and email = v_email
  for update;

  if v_invite.id is null then
    raise exception 'invite_invalid';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (v_invite.org_id, v_user, v_invite.role)
  on conflict (org_id, user_id) do nothing;

  update public.invites set accepted_at = now() where id = v_invite.id;
  insert into public.auth_events (user_id, org_id, kind) values (v_user, v_invite.org_id, 'invite_accepted');

  return v_invite.org_id;
end;
$$;

revoke execute on function public.create_organization(text) from public;
revoke execute on function public.accept_invite(text) from public;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase migration up
npx vitest run tests/db/org-functions.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add organization creation and invite acceptance functions"
```

---

## Task 10: The one-time code lifecycle

**Files:**
- Create: `supabase/migrations/0005_code_functions.sql`
- Test: `tests/db/codes.test.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces:
  - `public.issue_code(p_purpose public.code_purpose, p_ip text) returns text` — returns the plaintext 6-digit code for the caller to email; stores only the hash.
  - `public.verify_code(p_code text, p_purpose public.code_purpose) returns text` — returns `'ok'`, or raises `code_expired`, `code_incorrect`, `code_burned`.

- [ ] **Step 1: Write the failing code-lifecycle test**

```ts
// tests/db/codes.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client
let userId: string

const asUser = async (c: Client, id: string) =>
  c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: id })])

beforeAll(async () => {
  db = new Client({ connectionString: DB }); await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'codes@test.local', '', now(), now()) returning id`,
  )
  userId = u.rows[0].id
  await asUser(db, userId)
})

afterEach(async () => {
  await db.query(`delete from public.login_codes where user_id = $1`, [userId])
  await db.query(`delete from public.rate_limits`)
})

afterAll(async () => { await db.query(`delete from auth.users where id = $1`, [userId]); await db.end() })

describe('issue_code', () => {
  it('returns a six digit code and stores only its hash', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    expect(rows[0].code).toMatch(/^\d{6}$/)
    const stored = await db.query(`select code_hash from public.login_codes where user_id = $1`, [userId])
    expect(stored.rows[0].code_hash.toString()).not.toContain(rows[0].code)
  })

  it('invalidates any previous live code of the same purpose', async () => {
    await db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)
    await db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)
    const { rows } = await db.query(
      `select count(*)::int as n from public.login_codes
       where user_id = $1 and consumed_at is null`, [userId],
    )
    expect(rows[0].n).toBe(1)
  })

  it('rate limits after five requests in an hour', async () => {
    for (let i = 0; i < 5; i++) await db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)
    await expect(db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)).rejects.toThrow(/rate_limited/)
  })
})

describe('verify_code', () => {
  const verify = async (c: Client, code: string, purpose = 'signup_verify') =>
    (await c.query(`select public.verify_code($1, $2) as r`, [code, purpose])).rows[0].r as string

  it('accepts the right code once and refuses it thereafter', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    expect(await verify(db, rows[0].code)).toBe('ok')
    expect(await verify(db, rows[0].code)).toBe('code_incorrect')
  })

  it('refuses a code issued for a different purpose', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    expect(await verify(db, rows[0].code, 'device_challenge')).toBe('code_incorrect')
  })

  it('refuses an expired code', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    await db.query(`update public.login_codes set expires_at = now() - interval '1 minute' where user_id = $1`, [userId])
    expect(await verify(db, rows[0].code)).toBe('code_expired')
  })

  it('counts wrong attempts and burns the code on the fifth', async () => {
    await db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)

    for (let i = 0; i < 4; i++) expect(await verify(db, '000000')).toBe('code_incorrect')
    expect(await verify(db, '000000')).toBe('code_burned')

    const { rows } = await db.query(
      `select attempt_count, consumed_at from public.login_codes where user_id = $1`, [userId],
    )
    expect(rows[0].attempt_count).toBe(5)
    expect(rows[0].consumed_at).not.toBeNull()
  })

  it('lets exactly one of two parallel verifications succeed', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    const code = rows[0].code

    const a = new Client({ connectionString: DB })
    const b = new Client({ connectionString: DB })
    await a.connect(); await b.connect()
    await asUser(a, userId); await asUser(b, userId)

    const [ra, rb] = await Promise.all([verify(a, code), verify(b, code)])
    await a.end(); await b.end()

    // The row lock is what makes this true. Without FOR UPDATE, both pass.
    expect([ra, rb].filter((r) => r === 'ok')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/db/codes.test.ts`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Write `supabase/migrations/0005_code_functions.sql`**

```sql
-- Bumps a counter and raises if the caller is over the limit.
create or replace function public.bump_rate_limit(p_subject text, p_action text, p_limit int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_count  int;
begin
  insert into public.rate_limits (subject, action, window_start, count)
  values (p_subject, p_action, v_window, 1)
  on conflict (subject, action, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if v_count > p_limit then
    raise exception 'rate_limited';
  end if;
end;
$$;

create or replace function public.issue_code(p_purpose public.code_purpose, p_ip text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_code text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  perform public.bump_rate_limit(v_user::text, 'issue_code', 5);
  if p_ip is not null and p_ip <> '' then
    perform public.bump_rate_limit(p_ip, 'issue_code_ip', 5);
  end if;

  -- Only one live code per purpose. Issuing a new one retires the old.
  update public.login_codes
  set consumed_at = now()
  where user_id = v_user and purpose = p_purpose and consumed_at is null;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into public.login_codes (user_id, code_hash, purpose, expires_at)
  values (v_user, digest(v_code, 'sha256'), p_purpose, now() + interval '10 minutes');

  insert into public.auth_events (user_id, kind) values (v_user, 'code_sent');

  return v_code;
end;
$$;

create or replace function public.verify_code(p_code text, p_purpose public.code_purpose)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_row  public.login_codes;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- FOR UPDATE is load-bearing: without the row lock, two parallel requests
  -- can both pass against a single-use code.
  select * into v_row
  from public.login_codes
  where user_id = v_user and purpose = p_purpose and consumed_at is null
  order by created_at desc
  limit 1
  for update;

  -- Failures are RETURNED, never raised. `raise` aborts the transaction, which
  -- would roll back the very attempt_count increment that burns the code after
  -- five tries — the counter would sit at zero forever and the limit would
  -- never fire. Returning a status is what makes the counter durable.
  if v_row.id is null then
    return 'code_incorrect';
  end if;

  if v_row.expires_at <= now() then
    update public.login_codes set consumed_at = now() where id = v_row.id;
    return 'code_expired';
  end if;

  if v_row.code_hash <> digest(p_code, 'sha256') then
    update public.login_codes
    set attempt_count = attempt_count + 1,
        consumed_at = case when attempt_count + 1 >= 5 then now() else null end
    where id = v_row.id;

    insert into public.auth_events (user_id, kind) values (v_user, 'code_failed');

    if v_row.attempt_count + 1 >= 5 then
      return 'code_burned';
    end if;
    return 'code_incorrect';
  end if;

  update public.login_codes set consumed_at = now() where id = v_row.id;
  return 'ok';
end;
$$;

revoke execute on function public.issue_code(public.code_purpose, text) from public;
revoke execute on function public.verify_code(text, public.code_purpose) from public;
grant execute on function public.issue_code(public.code_purpose, text) to authenticated;
grant execute on function public.verify_code(text, public.code_purpose) to authenticated;
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase migration up
npx vitest run tests/db/codes.test.ts
```

Expected: PASS (9 tests), including the parallel-verification race.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add row-locked one-time code lifecycle with rate limiting"
```

---

## Task 11: Device trust functions

**Files:**
- Create: `supabase/migrations/0006_device_functions.sql`
- Test: `tests/db/devices.test.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces:
  - `public.trust_device(p_secret text, p_user_agent text, p_days int) returns uuid`
  - `public.is_device_trusted(p_secret text) returns boolean`
  - `public.revoke_all_devices() returns int`

- [ ] **Step 1: Write the failing device test**

```ts
// tests/db/devices.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client
let userId: string

beforeAll(async () => {
  db = new Client({ connectionString: DB }); await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'devices@test.local', '', now(), now()) returning id`,
  )
  userId = u.rows[0].id
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId })])
})

afterEach(async () => { await db.query(`delete from public.trusted_devices where user_id = $1`, [userId]) })
afterAll(async () => { await db.query(`delete from auth.users where id = $1`, [userId]); await db.end() })

describe('device trust', () => {
  it('trusts a device and recognises it afterwards', async () => {
    await db.query(`select public.trust_device('secret-a', 'Chrome on Windows', 30)`)
    const { rows } = await db.query(`select public.is_device_trusted('secret-a') as trusted`)
    expect(rows[0].trusted).toBe(true)
  })

  it('does not recognise an unknown device', async () => {
    const { rows } = await db.query(`select public.is_device_trusted('never-seen') as trusted`)
    expect(rows[0].trusted).toBe(false)
  })

  it('stores the hash, not the secret', async () => {
    await db.query(`select public.trust_device('secret-b', 'Safari', 30)`)
    const { rows } = await db.query(`select device_hash from public.trusted_devices where user_id = $1`, [userId])
    expect(rows[0].device_hash.toString()).not.toContain('secret-b')
  })

  it('stops recognising an expired device', async () => {
    await db.query(`select public.trust_device('secret-c', 'Firefox', 30)`)
    await db.query(`update public.trusted_devices set expires_at = now() - interval '1 day' where user_id = $1`, [userId])
    const { rows } = await db.query(`select public.is_device_trusted('secret-c') as trusted`)
    expect(rows[0].trusted).toBe(false)
  })

  it('revokes every device at once', async () => {
    await db.query(`select public.trust_device('secret-d', 'Chrome', 30)`)
    await db.query(`select public.trust_device('secret-e', 'Edge', 30)`)
    const { rows } = await db.query(`select public.revoke_all_devices() as n`)
    expect(rows[0].n).toBe(2)
    const check = await db.query(`select public.is_device_trusted('secret-d') as trusted`)
    expect(check.rows[0].trusted).toBe(false)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/db/devices.test.ts`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Write `supabase/migrations/0006_device_functions.sql`**

```sql
-- The stored value is a hash of the secret salted with the user id, so a
-- database dump yields nothing an attacker can present as a device.
create or replace function public.device_digest(p_user uuid, p_secret text)
returns bytea
language sql
immutable
as $$
  select digest(p_user::text || ':' || p_secret, 'sha256');
$$;

create or replace function public.trust_device(p_secret text, p_user_agent text, p_days int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_id   uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  insert into public.trusted_devices (user_id, device_hash, user_agent, label, expires_at)
  values (v_user, public.device_digest(v_user, p_secret), p_user_agent, p_user_agent,
          now() + make_interval(days => greatest(p_days, 1)))
  on conflict (user_id, device_hash) do update
    set last_seen_at = now(),
        revoked_at = null,
        expires_at = now() + make_interval(days => greatest(p_days, 1))
  returning id into v_id;

  insert into public.auth_events (user_id, kind, user_agent) values (v_user, 'device_trusted', p_user_agent);
  return v_id;
end;
$$;

create or replace function public.is_device_trusted(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_hit  boolean;
begin
  if v_user is null or p_secret is null or p_secret = '' then return false; end if;

  update public.trusted_devices
  set last_seen_at = now()
  where user_id = v_user
    and device_hash = public.device_digest(v_user, p_secret)
    and revoked_at is null
    and expires_at > now()
  returning true into v_hit;

  return coalesce(v_hit, false);
end;
$$;

create or replace function public.revoke_all_devices()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_n    int;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  update public.trusted_devices set revoked_at = now()
  where user_id = v_user and revoked_at is null;
  get diagnostics v_n = row_count;

  insert into public.auth_events (user_id, kind) values (v_user, 'device_revoked');
  return v_n;
end;
$$;

revoke execute on function public.trust_device(text, text, int) from public;
revoke execute on function public.is_device_trusted(text) from public;
revoke execute on function public.revoke_all_devices() from public;
grant execute on function public.trust_device(text, text, int) to authenticated;
grant execute on function public.is_device_trusted(text) to authenticated;
grant execute on function public.revoke_all_devices() to authenticated;
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase migration up
npx vitest run tests/db/devices.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add device trust functions with salted hashing"
```

---

## Task 12: The cross-tenant isolation proof

> This is the sub-project's exit test. It must pass before any screen work is considered done.

**Files:**
- Test: `tests/db/isolation.test.ts`

**Interfaces:**
- Consumes: every migration from Tasks 6–11. Produces no code — this task exists to prove a property.

- [ ] **Step 1: Write the isolation test**

```ts
// tests/db/isolation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let admin: Client
let alice: string
let bob: string
let aliceOrg: string
let bobOrg: string

const makeUser = async (email: string) => {
  const { rows } = await admin.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             $1, '', now(), now()) returning id`, [email],
  )
  return rows[0].id as string
}

// A client that behaves like PostgREST does for a signed-in user: the
// `authenticated` role, with the JWT claims set. This is what RLS sees.
const asUser = async (userId: string) => {
  const c = new Client({ connectionString: DB })
  await c.connect()
  await c.query(`set role authenticated`)
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  return c
}

beforeAll(async () => {
  admin = new Client({ connectionString: DB }); await admin.connect()
  alice = await makeUser('alice@isolation.test')
  bob = await makeUser('bob@isolation.test')

  const a = await asUser(alice)
  aliceOrg = (await a.query(`select public.create_organization('Alice Legal') as id`)).rows[0].id
  await a.end()

  const b = await asUser(bob)
  bobOrg = (await b.query(`select public.create_organization('Bob Legal') as id`)).rows[0].id
  await b.end()
})

afterAll(async () => {
  await admin.query(`delete from auth.users where id = any($1)`, [[alice, bob]])
  await admin.end()
})

describe('cross-tenant isolation', () => {
  it('shows each user only their own organization', async () => {
    const a = await asUser(alice)
    const { rows } = await a.query(`select id from public.organizations`)
    await a.end()
    expect(rows.map((r) => r.id)).toEqual([aliceOrg])
  })

  it('returns nothing when one user queries the other org by id', async () => {
    const a = await asUser(alice)
    const { rows } = await a.query(`select id from public.organizations where id = $1`, [bobOrg])
    await a.end()
    expect(rows).toHaveLength(0)
  })

  it('hides the other org members', async () => {
    const a = await asUser(alice)
    const { rows } = await a.query(`select user_id from public.org_members`)
    await a.end()
    expect(rows.map((r) => r.user_id)).toEqual([alice])
  })

  it('refuses a write into the other org', async () => {
    const a = await asUser(alice)
    await expect(
      a.query(`insert into public.invites (org_id, email, role, token_hash, expires_at)
               values ($1, 'x@y.z', 'member', digest('t','sha256'), now() + interval '1 day')`, [bobOrg]),
    ).rejects.toThrow(/row-level security/)
    await a.end()
  })

  it('never exposes a login code, not even the caller\'s own', async () => {
    const a = await asUser(alice)
    const { rows } = await a.query(`select count(*)::int as n from public.login_codes`)
    await a.end()
    expect(rows[0].n).toBe(0)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/db/isolation.test.ts`
Expected: PASS (5 tests). If any fails, a policy is wrong — fix the migration, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: prove cross-tenant isolation at the database level"
```

---

## Task 13: Supabase clients

> **Lanes A and B join here.** Requires Tasks 5 and 12.

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`
- Test: `tests/supabase-clients.test.ts`

**Interfaces:**
- Produces: `createBrowserSupabase()`, `createServerSupabase()`. These are the only two ways to obtain a client anywhere in the codebase.

- [ ] **Step 1: Write the failing guard test**

```ts
// tests/supabase-clients.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
  })

describe('supabase client usage', () => {
  it('never references a service role key anywhere in src', () => {
    const offenders = walk('src').filter((f) => /SERVICE_ROLE/i.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('constructs clients only inside lib/supabase', () => {
    const offenders = walk('src')
      .filter((f) => !f.includes(join('lib', 'supabase')))
      .filter((f) => /createServerClient|createBrowserClient/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run and confirm it passes trivially, then write the clients**

Run: `npx vitest run tests/supabase-clients.test.ts`
Expected: PASS (nothing exists yet). The test's job is to keep failing later if someone breaks the rule.

- [ ] **Step 3: Write `src/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 4: Write `src/lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabase() {
  const store = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options)
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session instead.
          }
        },
      },
    },
  )
}
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add browser and server Supabase clients"
```

---

## Task 14: The auth module

**Files:**
- Create: `src/lib/auth/device.ts`, `src/lib/auth/codes.ts`, `src/lib/auth/guards.ts`, `src/lib/auth/email.ts`, `src/lib/auth/errors.ts`
- Test: `tests/auth/device.test.ts`, `tests/auth/errors.test.ts`

**Interfaces:**
- Consumes: Task 13's clients, Tasks 10 and 11's SQL functions.
- Produces — every screen in Tasks 15–18 uses exactly these:
  - `getDeviceSecret(): Promise<string | null>`
  - `ensureDeviceSecret(): Promise<string>`
  - `issueAndSendCode(purpose: CodePurpose, email: string, locale: Locale): Promise<{ sent: boolean; error?: AuthErrorCode }>`
  - `verifyCode(code: string, purpose: CodePurpose): Promise<AuthResult>`
  - `requireSession(): Promise<Session>` — redirects to `/login` when absent
  - `requireVerified(): Promise<Session>` — redirects to `/verify` or `/challenge`
  - `type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode }`
  - `type AuthErrorCode = 'code_incorrect' | 'code_expired' | 'code_burned' | 'rate_limited' | 'invalid_credentials' | 'unknown'`

- [ ] **Step 1: Write the failing error-mapping test**

```ts
// tests/auth/errors.test.ts
import { describe, it, expect } from 'vitest'
import { toAuthErrorCode } from '@/lib/auth/errors'

describe('toAuthErrorCode', () => {
  it.each([
    ['code_incorrect', 'code_incorrect'],
    ['code_expired', 'code_expired'],
    ['code_burned', 'code_burned'],
    ['rate_limited', 'rate_limited'],
  ])('maps the SQL exception %s', (raised, expected) => {
    expect(toAuthErrorCode({ message: `${raised}` })).toBe(expected)
  })

  it('maps anything unrecognised to unknown', () => {
    expect(toAuthErrorCode({ message: 'connection reset by peer' })).toBe('unknown')
  })

  it('collapses every credential failure to one indistinguishable code', () => {
    expect(toAuthErrorCode({ message: 'Invalid login credentials' })).toBe('invalid_credentials')
    expect(toAuthErrorCode({ message: 'Email not confirmed' })).toBe('invalid_credentials')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/auth/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/auth/errors.ts`**

```ts
export type AuthErrorCode =
  | 'code_incorrect' | 'code_expired' | 'code_burned'
  | 'rate_limited' | 'invalid_credentials' | 'unknown'

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode }

const SQL_CODES: AuthErrorCode[] = ['code_incorrect', 'code_expired', 'code_burned', 'rate_limited']

// Every credential failure collapses to one code so the login form cannot be
// used to discover which emails have accounts.
const CREDENTIAL_PATTERNS = [/invalid login credentials/i, /email not confirmed/i, /user not found/i]

export function toAuthErrorCode(error: { message?: string } | null | undefined): AuthErrorCode {
  const message = error?.message ?? ''
  for (const c of SQL_CODES) if (message.includes(c)) return c
  for (const p of CREDENTIAL_PATTERNS) if (p.test(message)) return 'invalid_credentials'
  return 'unknown'
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/auth/errors.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing device-cookie test**

```ts
// tests/auth/device.test.ts
import { describe, it, expect } from 'vitest'
import { newDeviceSecret, DEVICE_COOKIE_OPTIONS } from '@/lib/auth/device'

describe('device secret', () => {
  it('generates a long, url-safe, unguessable secret', () => {
    const s = newDeviceSecret()
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newDeviceSecret()).not.toBe(s)
  })

  it('is stored in an httpOnly, sameSite cookie', () => {
    expect(DEVICE_COOKIE_OPTIONS.httpOnly).toBe(true)
    expect(DEVICE_COOKIE_OPTIONS.sameSite).toBe('lax')
    expect(DEVICE_COOKIE_OPTIONS.path).toBe('/')
  })
})
```

- [ ] **Step 6: Run and confirm failure**

Run: `npx vitest run tests/auth/device.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write `src/lib/auth/device.ts`**

```ts
import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'

export const DEVICE_COOKIE = process.env.DEVICE_COOKIE_NAME ?? 'aqd_device'

export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

export function newDeviceSecret(): string {
  return randomBytes(32).toString('base64url')
}

export async function getDeviceSecret(): Promise<string | null> {
  const store = await cookies()
  return store.get(DEVICE_COOKIE)?.value ?? null
}

/** Returns the existing secret, minting and setting one if absent. */
export async function ensureDeviceSecret(persistDays?: number): Promise<string> {
  const store = await cookies()
  const existing = store.get(DEVICE_COOKIE)?.value
  if (existing) return existing

  const secret = newDeviceSecret()
  store.set(DEVICE_COOKIE, secret, {
    ...DEVICE_COOKIE_OPTIONS,
    ...(persistDays ? { maxAge: persistDays * 24 * 60 * 60 } : {}),
  })
  return secret
}
```

- [ ] **Step 8: Run and confirm it passes**

Run: `npx vitest run tests/auth/device.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Write `src/lib/auth/email.ts`**

```ts
import { Resend } from 'resend'
import type { Locale } from '@/lib/i18n/config'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const SUBJECT: Record<Locale, string> = {
  en: 'Your Aqd AI verification code',
  ar: 'رمز التحقق الخاص بك في عقد',
}

const BODY: Record<Locale, (code: string) => string> = {
  en: (code) =>
    `<p>Your verification code is:</p><p style="font-size:28px;letter-spacing:.2em;font-weight:700">${code}</p><p>It expires in 10 minutes. If you didn't request it, ignore this email.</p>`,
  ar: (code) =>
    `<div dir="rtl"><p>رمز التحقق الخاص بك:</p><p style="font-size:28px;letter-spacing:.2em;font-weight:700">${code}</p><p>تنتهي صلاحيته خلال ١٠ دقائق. إن لم تطلبه، تجاهل هذه الرسالة.</p></div>`,
}

/** Returns false rather than throwing: a send failure must not strand the user. */
export async function sendCodeEmail(to: string, code: string, locale: Locale): Promise<boolean> {
  if (!resend) {
    if (process.env.NODE_ENV !== 'production') console.info(`[dev] code for ${to}: ${code}`)
    return process.env.NODE_ENV !== 'production'
  }
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject: SUBJECT[locale],
      html: BODY[locale](code),
    })
    return true
  } catch {
    return false
  }
}
```

Without a `RESEND_API_KEY`, development logs the code to the console instead of sending — so the whole flow is testable with no email provider.

- [ ] **Step 10: Write `src/lib/auth/codes.ts`**

```ts
import { createServerSupabase } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { sendCodeEmail } from './email'
import { toAuthErrorCode, type AuthResult } from './errors'
import type { Locale } from '@/lib/i18n/config'

export type CodePurpose = 'signup_verify' | 'device_challenge'

export async function issueAndSendCode(
  purpose: CodePurpose,
  email: string,
  locale: Locale,
): Promise<{ sent: boolean; error?: ReturnType<typeof toAuthErrorCode> }> {
  const supabase = await createServerSupabase()
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''

  const { data, error } = await supabase.rpc('issue_code', { p_purpose: purpose, p_ip: ip })
  if (error) return { sent: false, error: toAuthErrorCode(error) }

  const sent = await sendCodeEmail(email, data as string, locale)

  // A send failure must be visible rather than silent — the user still reaches
  // the verify screen, and this is how we know why their code never arrived.
  if (!sent) {
    await supabase.from('auth_events').insert({ kind: 'code_send_failed' })
  }

  return { sent }
}

export async function verifyCode(code: string, purpose: CodePurpose): Promise<AuthResult> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('verify_code', { p_code: code, p_purpose: purpose })
  if (error) return { ok: false, code: toAuthErrorCode(error) }

  // verify_code returns its verdict rather than raising, so the failure status
  // arrives in `data`, not `error`.
  return data === 'ok' ? { ok: true } : { ok: false, code: toAuthErrorCode({ message: String(data) }) }
}
```

- [ ] **Step 11: Write `src/lib/auth/guards.ts`**

```ts
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createServerSupabase } from '@/lib/supabase/server'
import { getDeviceSecret } from './device'

export const requireSession = cache(async () => {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return user
})

/**
 * A fully verified session: the email is confirmed AND this device is trusted.
 * Both checks are server-side reads. There is no client-side flag that grants entry.
 */
export const requireVerified = cache(async () => {
  const user = await requireSession()
  if (!user.email_confirmed_at) redirect('/verify')

  const supabase = await createServerSupabase()
  const secret = await getDeviceSecret()
  const { data: trusted } = await supabase.rpc('is_device_trusted', { p_secret: secret ?? '' })
  if (!trusted) redirect('/challenge')

  return user
})
```

- [ ] **Step 12: Run the full suite and commit**

```bash
npm test
git add -A
git commit -m "feat: add the auth module — device trust, codes, guards, email"
```

---

## Task 15: Signup and verify screens

> **LANE C.** May run concurrently with Task 17.

**Files:**
- Create: `src/app/(auth)/layout.tsx`, `src/components/auth/auth-shell.tsx`
- Create: `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/signup/actions.ts`
- Create: `src/app/(auth)/verify/page.tsx`, `src/app/(auth)/verify/actions.ts`
- Test: `tests/auth/signup-action.test.ts`

**Interfaces:**
- Consumes: `Button`, `Input`, `CodeInput`, `issueAndSendCode`, `verifyCode`, `ensureDeviceSecret`, message keys under `auth.signup` and `auth.verify`.
- Produces: `signUp(formData): Promise<{ error?: AuthErrorCode }>`, `submitVerification(formData)`. Task 17 mirrors this shape.

- [ ] **Step 1: Write the failing validation test**

```ts
// tests/auth/signup-action.test.ts
import { describe, it, expect } from 'vitest'
import { validateSignup } from '@/app/(auth)/signup/validate'

describe('validateSignup', () => {
  it('accepts a well-formed email and a long password', () => {
    expect(validateSignup('hazem@example.com', 'a-long-enough-password')).toBeNull()
  })

  it('rejects a malformed email', () => {
    expect(validateSignup('hazem@', 'a-long-enough-password')).toBe('invalidEmail')
  })

  it('rejects a password under ten characters', () => {
    expect(validateSignup('hazem@example.com', 'short')).toBe('weakPassword')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/auth/signup-action.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/app/(auth)/signup/validate.ts`**

```ts
export type SignupIssue = 'invalidEmail' | 'weakPassword'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateSignup(email: string, password: string): SignupIssue | null {
  if (!EMAIL.test(email)) return 'invalidEmail'
  if (password.length < 10) return 'weakPassword'
  return null
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/auth/signup-action.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the auth shell**

```tsx
// src/components/auth/auth-shell.tsx
export function AuthShell({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <h1 className="mb-2 font-serif text-3xl font-medium tracking-tight text-ink">{title}</h1>
          <p className="mb-8 text-sm text-ink-dim">{subtitle}</p>
          {children}
        </div>
      </div>
      <div className="hidden bg-surface-3 lg:block" aria-hidden="true" />
    </div>
  )
}
```

```tsx
// src/app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="bg-surface">{children}</main>
}
```

The auth group gets its own error boundary. This is why the boundary is per
route group rather than global: a crash inside the app shell must not take the
sign-in screen down with it, or a user hitting a bug has no way back in.

```tsx
// src/app/(auth)/error.tsx
'use client'
import { Button } from '@/components/ui/button'

export default function AuthError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="mb-2 font-serif text-2xl text-ink">Something went wrong</h1>
        <p className="mb-6 text-sm text-ink-dim">
          We couldn&apos;t load this page. Your account is unaffected.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write the signup action**

```ts
// src/app/(auth)/signup/actions.ts
'use server'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { issueAndSendCode } from '@/lib/auth/codes'
import { toAuthErrorCode } from '@/lib/auth/errors'
import { validateSignup } from './validate'
import type { Locale } from '@/lib/i18n/config'

export async function signUp(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const issue = validateSignup(email, password)
  if (issue) return { error: issue }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) return { error: toAuthErrorCode(error) }

  const locale = (await getLocale()) as Locale
  const { sent } = await issueAndSendCode('signup_verify', email, locale)

  redirect(sent ? '/verify' : '/verify?send=failed')
}
```

- [ ] **Step 7: Write the signup page**

```tsx
// src/app/(auth)/signup/page.tsx
'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signUp } from './actions'

export default function SignupPage() {
  const t = useTranslations('auth.signup')
  const e = useTranslations('auth.errors')
  const [state, action, pending] = useActionState(signUp, null)

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={action} className="flex flex-col gap-4">
        <Input
          label={t('email')} name="email" type="email" required autoComplete="email"
          error={state?.error === 'invalidEmail' ? e('invalidEmail') : undefined}
        />
        <Input
          label={t('password')} name="password" type="password" required autoComplete="new-password"
          error={state?.error === 'weakPassword' ? e('weakPassword') : undefined}
        />
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </form>
      <p className="mt-6 text-sm text-ink-dim">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-accent underline">{t('signIn')}</Link>
      </p>
    </AuthShell>
  )
}
```

- [ ] **Step 8: Write the verify action and page**

```ts
// src/app/(auth)/verify/actions.ts
'use server'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { headers } from 'next/headers'
import { createServerSupabase } from '@/lib/supabase/server'
import { verifyCode, issueAndSendCode } from '@/lib/auth/codes'
import { ensureDeviceSecret } from '@/lib/auth/device'
import type { Locale } from '@/lib/i18n/config'

const TRUST_DAYS = 30

export async function submitVerification(_prev: unknown, formData: FormData) {
  const code = String(formData.get('code') ?? '')
  const result = await verifyCode(code, 'signup_verify')
  if (!result.ok) return { error: result.code }

  // Verifying at signup also trusts the device it happened on.
  const supabase = await createServerSupabase()
  const secret = await ensureDeviceSecret(TRUST_DAYS)
  const h = await headers()
  await supabase.rpc('trust_device', {
    p_secret: secret,
    p_user_agent: h.get('user-agent') ?? 'unknown',
    p_days: TRUST_DAYS,
  })

  redirect('/onboarding')
}

export async function resendCode() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'unknown' as const }
  const locale = (await getLocale()) as Locale
  const { sent, error } = await issueAndSendCode('signup_verify', user.email, locale)
  return sent ? {} : { error: error ?? ('unknown' as const) }
}
```

```tsx
// src/app/(auth)/verify/page.tsx
'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { CodeInput } from '@/components/ui/code-input'
import { submitVerification, resendCode } from './actions'

export default function VerifyPage() {
  const t = useTranslations('auth.verify')
  const e = useTranslations('auth.errors')
  const params = useSearchParams()
  const [code, setCode] = useState('')
  const [state, action, pending] = useActionState(submitVerification, null)

  const errorText =
    state?.error === 'code_expired' ? e('codeExpired')
    : state?.error === 'code_burned' ? e('codeBurned')
    : state?.error === 'code_incorrect' ? e('codeIncorrect', { remaining: 4 })
    : undefined

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle', { email: '' })}>
      {params.get('send') === 'failed' && (
        <p role="alert" className="mb-4 rounded-lg bg-surface-3 p-3 text-sm text-ink-dim">
          {t('sendFailed')}
        </p>
      )}
      <form action={action} className="flex flex-col gap-5">
        <CodeInput label={t('code')} value={code} onChange={setCode} error={errorText} />
        <input type="hidden" name="code" value={code} />
        <Button type="submit" loading={pending} disabled={code.length < 6}>{t('submit')}</Button>
      </form>
      <form action={resendCode} className="mt-4">
        <Button type="submit" variant="ghost">{t('resend')}</Button>
      </form>
    </AuthShell>
  )
}
```

- [ ] **Step 9: Verify the flow by hand**

```bash
npm run dev
```

Sign up at `/signup`. With no `RESEND_API_KEY` set, the code prints to the dev-server console. Enter it and confirm you land on `/onboarding`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add signup and email verification screens"
```

---

## Task 16: Password reset that revokes device trust

**Files:**
- Create: `src/app/(auth)/reset/page.tsx`, `src/app/(auth)/reset/actions.ts`
- Test: `tests/auth/reset.test.ts`

**Interfaces:**
- Consumes: Supabase's native recovery OTP, Task 11's `revoke_all_devices`.
- Produces: `requestReset(formData)`, `confirmReset(formData)`.

> **Why this does not use `issue_code`.** `issue_code` reads the caller's `sub`
> claim, and a person asking for a password reset is signed *out* — there is no
> claim to read. It also must not: reusing the `device_challenge` purpose here
> would let a reset code satisfy a device challenge, which is exactly the
> replay the `purpose` enum exists to prevent. Supabase's own recovery OTP is
> the correct primitive, and it needs no session.

- [ ] **Step 1: Configure Supabase to send a recovery code, not a link**

In `supabase/config.toml`, set the recovery template to emit the token:

```toml
[auth.email.template.recovery]
subject = "Your Aqd AI password reset code"
content_path = "./supabase/templates/recovery.html"
```

```html
<!-- supabase/templates/recovery.html -->
<p>Your password reset code is:</p>
<p style="font-size:28px;letter-spacing:.2em;font-weight:700">{{ .Token }}</p>
<p>It expires in 10 minutes. If you didn't request it, ignore this email.</p>
```

Restart: `npx supabase stop && npx supabase start`

- [ ] **Step 2: Write the failing behaviour test**

```ts
// tests/auth/reset.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
const updateUser = vi.fn().mockResolvedValue({ error: null })
const verifyOtp = vi.fn().mockResolvedValue({ error: null })
const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
const getUser = vi.fn().mockResolvedValue({ data: { user: { email: 'a@b.c' } } })

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    rpc,
    auth: { updateUser, verifyOtp, resetPasswordForEmail, getUser },
  }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  rpc.mockClear(); updateUser.mockClear(); verifyOtp.mockClear(); resetPasswordForEmail.mockClear()
})

describe('requestReset', () => {
  it('reports success even for an address with no account', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'User not found' } })
    const { requestReset } = await import('@/app/(auth)/reset/actions')
    const fd = new FormData(); fd.set('email', 'ghost@nowhere.test')
    await expect(requestReset(null, fd)).resolves.toBeUndefined()
  })
})

describe('confirmReset', () => {
  it('revokes every trusted device after changing the password', async () => {
    const { confirmReset } = await import('@/app/(auth)/reset/actions')
    const fd = new FormData()
    fd.set('email', 'a@b.c')
    fd.set('code', '123456')
    fd.set('password', 'a-brand-new-password')
    await confirmReset(null, fd)

    expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.c', token: '123456', type: 'recovery' })
    expect(updateUser).toHaveBeenCalledWith({ password: 'a-brand-new-password' })
    expect(rpc).toHaveBeenCalledWith('revoke_all_devices')
  })

  it('does not change the password when the code is wrong', async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } })
    const { confirmReset } = await import('@/app/(auth)/reset/actions')
    const fd = new FormData()
    fd.set('email', 'a@b.c'); fd.set('code', '000000'); fd.set('password', 'whatever-long')
    const result = await confirmReset(null, fd)

    expect(result).toEqual({ error: 'code_incorrect' })
    expect(updateUser).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run tests/auth/reset.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/app/(auth)/reset/actions.ts`**

```ts
'use server'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { validateSignup } from '../signup/validate'

export async function requestReset(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const supabase = await createServerSupabase()

  // The result is deliberately ignored. A reset form that behaved differently
  // for a known and an unknown address would be an account-enumeration oracle.
  await supabase.auth.resetPasswordForEmail(email)

  redirect(`/reset?step=confirm&email=${encodeURIComponent(email)}`)
}

export async function confirmReset(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const code = String(formData.get('code') ?? '')
  const password = String(formData.get('password') ?? '')

  if (password.length < 10) return { error: 'weakPassword' as const }

  const supabase = await createServerSupabase()

  const { error: otpError } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' })
  if (otpError) return { error: 'code_incorrect' as const }

  const { error: updateError } = await supabase.auth.updateUser({ password })
  if (updateError) return { error: 'unknown' as const }

  // A stolen password already used from a trusted device would otherwise keep
  // working after the reset. Revoking here is what closes that hole.
  await supabase.rpc('revoke_all_devices')

  redirect('/login?reset=done')
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/auth/reset.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/app/(auth)/reset/page.tsx`**

```tsx
'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CodeInput } from '@/components/ui/code-input'
import { requestReset, confirmReset } from './actions'

export default function ResetPage() {
  const t = useTranslations('auth.reset')
  const e = useTranslations('auth.errors')
  const params = useSearchParams()
  const step = params.get('step')
  const email = params.get('email') ?? ''
  const [code, setCode] = useState('')
  const [, reqAction, reqPending] = useActionState(requestReset, null)
  const [confState, confAction, confPending] = useActionState(confirmReset, null)

  if (step === 'confirm') {
    return (
      <AuthShell title={t('title')} subtitle={t('subtitle')}>
        <form action={confAction} className="flex flex-col gap-5">
          <CodeInput
            label={t('code')} value={code} onChange={setCode}
            error={confState?.error === 'code_incorrect' ? e('codeIncorrect', { remaining: 4 }) : undefined}
          />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="email" value={email} />
          <Input
            label={t('newPassword')} name="password" type="password" required autoComplete="new-password"
            error={confState?.error === 'weakPassword' ? e('weakPassword') : undefined}
          />
          <Button type="submit" loading={confPending} disabled={code.length < 6}>{t('confirm')}</Button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={reqAction} className="flex flex-col gap-4">
        <Input label={t('email')} name="email" type="email" required autoComplete="email" />
        <Button type="submit" loading={reqPending}>{t('submit')}</Button>
      </form>
    </AuthShell>
  )
}
```

This page uses one message key that Task 5 did not create. Add `"code"` inside the existing `auth.reset` object in both files — `"code": "Reset code"` in `messages/en.json` and `"code": "رمز إعادة التعيين"` in `messages/ar.json`. The key-parity test in `tests/i18n.test.ts` fails if you add it to only one.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add password reset that revokes all trusted devices"
```

---

## Task 17: Login and the new-device challenge

> **LANE D.** May run concurrently with Task 15. Requires Task 14.

**Files:**
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/actions.ts`
- Create: `src/app/(auth)/challenge/page.tsx`, `src/app/(auth)/challenge/actions.ts`
- Test: `tests/auth/login.test.ts`

**Interfaces:**
- Consumes: Task 14's module.
- Produces: `signIn(formData)`, `submitChallenge(formData)`.

- [ ] **Step 1: Write the failing login-routing test**

```ts
// tests/auth/login.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn()
const signInWithPassword = vi.fn()
const rpc = vi.fn()
const issueAndSendCode = vi.fn().mockResolvedValue({ sent: true })

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { signInWithPassword, getUser: async () => ({ data: { user: { email: 'a@b.c' } } }) }, rpc }),
}))
vi.mock('@/lib/auth/device', () => ({ getDeviceSecret: async () => 'known-secret' }))
vi.mock('@/lib/auth/codes', () => ({ issueAndSendCode }))

beforeEach(() => { redirect.mockClear(); rpc.mockClear(); issueAndSendCode.mockClear() })

describe('signIn', () => {
  it('goes straight to the app when the device is trusted', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ data: true, error: null })
    const { signIn } = await import('@/app/(auth)/login/actions')
    const fd = new FormData(); fd.set('email', 'a@b.c'); fd.set('password', 'x'.repeat(12))
    await signIn(null, fd)
    expect(redirect).toHaveBeenCalledWith('/')
    expect(issueAndSendCode).not.toHaveBeenCalled()
  })

  it('challenges when the device is not trusted', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ data: false, error: null })
    const { signIn } = await import('@/app/(auth)/login/actions')
    const fd = new FormData(); fd.set('email', 'a@b.c'); fd.set('password', 'x'.repeat(12))
    await signIn(null, fd)
    expect(issueAndSendCode).toHaveBeenCalledWith('device_challenge', 'a@b.c', expect.anything())
    expect(redirect).toHaveBeenCalledWith('/challenge')
  })

  it('returns one indistinguishable error for any credential failure', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const { signIn } = await import('@/app/(auth)/login/actions')
    const fd = new FormData(); fd.set('email', 'a@b.c'); fd.set('password', 'x'.repeat(12))
    expect(await signIn(null, fd)).toEqual({ error: 'invalid_credentials' })
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/auth/login.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/app/(auth)/login/actions.ts`**

```ts
'use server'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getDeviceSecret } from '@/lib/auth/device'
import { issueAndSendCode } from '@/lib/auth/codes'
import { toAuthErrorCode } from '@/lib/auth/errors'
import type { Locale } from '@/lib/i18n/config'

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: toAuthErrorCode(error) }

  const secret = await getDeviceSecret()
  const { data: trusted } = await supabase.rpc('is_device_trusted', { p_secret: secret ?? '' })
  if (trusted) redirect('/')

  const locale = (await getLocale()) as Locale
  await issueAndSendCode('device_challenge', email, locale)
  redirect('/challenge')
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/auth/login.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the login page**

```tsx
// src/app/(auth)/login/page.tsx
'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signIn } from './actions'

export default function LoginPage() {
  const t = useTranslations('auth.login')
  const e = useTranslations('auth.errors')
  const [state, action, pending] = useActionState(signIn, null)

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={action} className="flex flex-col gap-4">
        <Input label={t('email')} name="email" type="email" required autoComplete="email" />
        <Input label={t('password')} name="password" type="password" required autoComplete="current-password" />
        {state?.error && <p role="alert" className="text-xs text-risk-high">{e('invalidCredentials')}</p>}
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-sm text-ink-dim">
        <Link href="/reset" className="text-accent underline">{t('forgot')}</Link>
        <span>{t('noAccount')} <Link href="/signup" className="text-accent underline">{t('signUp')}</Link></span>
      </div>
    </AuthShell>
  )
}
```

- [ ] **Step 6: Write the challenge action**

```ts
// src/app/(auth)/challenge/actions.ts
'use server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createServerSupabase } from '@/lib/supabase/server'
import { verifyCode } from '@/lib/auth/codes'
import { ensureDeviceSecret } from '@/lib/auth/device'

const TRUST_DAYS = 30

export async function submitChallenge(_prev: unknown, formData: FormData) {
  const code = String(formData.get('code') ?? '')
  const trust = formData.get('trust') === 'on'

  const result = await verifyCode(code, 'device_challenge')
  if (!result.ok) return { error: result.code }

  // Unchecked, the cookie is session-scoped and the device row expires with it,
  // so the next login challenges again.
  const secret = await ensureDeviceSecret(trust ? TRUST_DAYS : undefined)
  const supabase = await createServerSupabase()
  const h = await headers()
  await supabase.rpc('trust_device', {
    p_secret: secret,
    p_user_agent: h.get('user-agent') ?? 'unknown',
    p_days: trust ? TRUST_DAYS : 1,
  })

  redirect('/')
}
```

- [ ] **Step 7: Write the challenge page**

```tsx
// src/app/(auth)/challenge/page.tsx
'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { CodeInput } from '@/components/ui/code-input'
import { submitChallenge } from './actions'

export default function ChallengePage() {
  const t = useTranslations('auth.challenge')
  const e = useTranslations('auth.errors')
  const [code, setCode] = useState('')
  const [state, action, pending] = useActionState(submitChallenge, null)

  const errorText =
    state?.error === 'code_expired' ? e('codeExpired')
    : state?.error === 'code_burned' ? e('codeBurned')
    : state?.error ? e('codeIncorrect', { remaining: 4 })
    : undefined

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={action} className="flex flex-col gap-5">
        <CodeInput label={t('code')} value={code} onChange={setCode} error={errorText} />
        <input type="hidden" name="code" value={code} />
        <label className="flex items-center gap-2 text-sm text-ink-dim">
          <input type="checkbox" name="trust" defaultChecked className="accent-[var(--color-accent)]" />
          {t('trust')}
        </label>
        <Button type="submit" loading={pending} disabled={code.length < 6}>{t('submit')}</Button>
      </form>
    </AuthShell>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add login and new-device challenge screens"
```

---

## Task 18: Onboarding and the verified-session guard

> **Lanes C and D join here.**

**Files:**
- Create: `src/app/onboarding/page.tsx`, `src/app/onboarding/actions.ts`
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`
- Create: `src/middleware.ts`
- Test: `tests/auth/guard.test.ts`

**Interfaces:**
- Consumes: `requireVerified`, `create_organization`, `accept_invite`.
- Produces: the protected `(app)` group every later sub-project builds inside.

- [ ] **Step 1: Write the failing guard test**

```ts
// tests/auth/guard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn(() => { throw new Error('REDIRECT') })
let user: Record<string, unknown> | null = { id: 'u1', email_confirmed_at: '2026-01-01' }
let deviceTrusted = true

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, cache: (fn: unknown) => fn }
})
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async () => ({ data: deviceTrusted, error: null }),
  }),
}))
vi.mock('@/lib/auth/device', () => ({ getDeviceSecret: async () => 'secret' }))

beforeEach(() => { redirect.mockClear() })

describe('requireVerified', () => {
  it('allows a confirmed user on a trusted device', async () => {
    user = { id: 'u1', email_confirmed_at: '2026-01-01' }; deviceTrusted = true
    const { requireVerified } = await import('@/lib/auth/guards')
    await expect(requireVerified()).resolves.toMatchObject({ id: 'u1' })
  })

  it('sends an unconfirmed user to verify', async () => {
    user = { id: 'u1', email_confirmed_at: null }; deviceTrusted = true
    const { requireVerified } = await import('@/lib/auth/guards')
    await expect(requireVerified()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/verify')
  })

  it('sends an untrusted device to the challenge', async () => {
    user = { id: 'u1', email_confirmed_at: '2026-01-01' }; deviceTrusted = false
    const { requireVerified } = await import('@/lib/auth/guards')
    await expect(requireVerified()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/challenge')
  })

  it('sends a signed-out visitor to login', async () => {
    user = null
    const { requireVerified } = await import('@/lib/auth/guards')
    await expect(requireVerified()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})
```

Add `vi.resetModules()` in `beforeEach` so each case re-imports with fresh mocks.

- [ ] **Step 2: Run and confirm it passes**

Run: `npx vitest run tests/auth/guard.test.ts`
Expected: PASS (4 tests). `requireVerified` already exists from Task 14 — this task proves it behaves.

- [ ] **Step 3: Write the onboarding action**

```ts
// src/app/onboarding/actions.ts
'use server'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

export async function createOrganization(_prev: unknown, formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  if (name.length < 2) return { error: 'invalid_name' as const }

  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('create_organization', { p_name: name })
  if (error) return { error: 'unknown' as const }

  // The org claim is stamped at token mint, so refresh before entering the app.
  await supabase.auth.refreshSession()
  redirect('/')
}

export async function acceptInvite(_prev: unknown, formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) return { error: 'invite_invalid' as const }

  await supabase.auth.refreshSession()
  redirect('/')
}
```

- [ ] **Step 4: Write the onboarding page**

```tsx
// src/app/onboarding/page.tsx
'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createOrganization } from './actions'

export default function OnboardingPage() {
  const t = useTranslations('onboarding')
  const [state, action, pending] = useActionState(createOrganization, null)

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={action} className="flex flex-col gap-4">
        <Input
          label={t('name')} name="name" required
          error={state?.error === 'invalid_name' ? t('name') : undefined}
        />
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </form>
    </AuthShell>
  )
}
```

- [ ] **Step 5: Write the protected layout**

```tsx
// src/app/(app)/layout.tsx
import { requireVerified } from '@/lib/auth/guards'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireVerified()
  return <div className="min-h-dvh bg-surface">{children}</div>
}
```

```tsx
// src/app/(app)/page.tsx
import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const t = useTranslations('common')
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-serif text-4xl font-medium tracking-tight text-ink">{t('appName')}</h1>
    </main>
  )
}
```

```tsx
// src/app/(app)/error.tsx
'use client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-serif text-2xl text-ink">Something went wrong</h1>
      <p className="text-sm text-ink-dim">This page failed to load. Nothing was lost.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/login"><Button variant="secondary">Sign in again</Button></Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write the session-refresh middleware**

```ts
// src/middleware.ts
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) response.cookies.set(name, value, options)
        },
      },
    },
  )

  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
```

- [ ] **Step 7: Walk the whole flow by hand**

```bash
npm run dev
```

Sign up → verify → create org → land on the dashboard. Then sign out, clear the device cookie in devtools, sign in again, and confirm the challenge screen appears.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add onboarding and the verified-session guard"
```

---

## Task 19: End-to-end auth journeys

**Files:**
- Create: `e2e/auth.spec.ts`, `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the running app. Produces no application code.

- [ ] **Step 1: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
```

- [ ] **Step 2: Write the journey spec**

```ts
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// Reads the code straight from the database — the dev mail transport doesn't send.
async function latestCode(email: string): Promise<string> {
  const db = new Client({ connectionString: DB })
  await db.connect()
  for (let attempt = 0; attempt < 10; attempt++) {
    const { rows } = await db.query(
      `select c.id from public.login_codes c
       join auth.users u on u.id = c.user_id
       where u.email = $1 and c.consumed_at is null
       order by c.created_at desc limit 1`, [email],
    )
    if (rows.length) break
    await new Promise((r) => setTimeout(r, 300))
  }
  // Brute-force the 6-digit space against the stored hash for test purposes only.
  const { rows } = await db.query(
    `select code from generate_series(0, 999999) g(n),
       lateral (select lpad(g.n::text, 6, '0') as code) s
     where digest(s.code, 'sha256') = (
       select c.code_hash from public.login_codes c
       join auth.users u on u.id = c.user_id
       where u.email = $1 and c.consumed_at is null
       order by c.created_at desc limit 1)
     limit 1`, [email],
  )
  await db.end()
  return rows[0].code
}

test('a new user signs up, verifies, and reaches the dashboard', async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('a-long-enough-password')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

  const code = await latestCode(email)
  for (const [i, digit] of [...code].entries()) {
    await page.getByLabel(`Digit ${i + 1}`).fill(digit)
  }
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByRole('heading', { name: 'Create your organization' })).toBeVisible()
  await page.getByLabel('Organization name').fill('E2E Legal')
  await page.getByRole('button', { name: 'Create organization' }).click()

  await expect(page.getByRole('heading', { name: 'Aqd AI' })).toBeVisible()
})

test('an unverified visitor cannot reach the app by URL', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('signing in on a fresh device raises the challenge', async ({ browser }) => {
  const email = `e2e-dev-${Date.now()}@test.local`
  const first = await browser.newContext()
  const p1 = await first.newPage()
  await p1.goto('/signup')
  await p1.getByLabel('Email').fill(email)
  await p1.getByLabel('Password').fill('a-long-enough-password')
  await p1.getByRole('button', { name: 'Create account' }).click()
  const code = await latestCode(email)
  for (const [i, d] of [...code].entries()) await p1.getByLabel(`Digit ${i + 1}`).fill(d)
  await p1.getByRole('button', { name: 'Verify' }).click()
  await p1.getByLabel('Organization name').fill('Device Co')
  await p1.getByRole('button', { name: 'Create organization' }).click()
  await first.close()

  // A second context has no device cookie — this is the "new device" case.
  const second = await browser.newContext()
  const p2 = await second.newPage()
  await p2.goto('/login')
  await p2.getByLabel('Email').fill(email)
  await p2.getByLabel('Password').fill('a-long-enough-password')
  await p2.getByRole('button', { name: 'Sign in' }).click()
  await expect(p2.getByRole('heading', { name: 'Verify this device' })).toBeVisible()
  await second.close()
})
```

- [ ] **Step 3: Run the suite**

Run: `npm run e2e`
Expected: PASS (3 tests). Supabase must be running.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: add end-to-end auth journey coverage"
```

---

## Task 20: Visual, accessibility and token audits

**Files:**
- Create: `e2e/visual.spec.ts`, `e2e/a11y.spec.ts`
- Create: `tests/token-audit.test.ts`

**Interfaces:**
- Consumes: every screen. Produces no application code. This task is the design system's guarantee.

- [ ] **Step 1: Write the token audit**

```ts
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
```

- [ ] **Step 2: Run it and fix any offender**

Run: `npx vitest run tests/token-audit.test.ts`
Expected: PASS. If a file is listed, replace the literal with a token or the physical utility with its logical equivalent — do not weaken the test.

- [ ] **Step 3: Write the accessibility spec**

```ts
// e2e/a11y.spec.ts
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const SCREENS = ['/signup', '/login', '/reset']

for (const path of SCREENS) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${path} has no accessibility violations in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(path)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze()
      expect(results.violations).toEqual([])
    })
  }
}
```

- [ ] **Step 4: Write the visual spec**

```ts
// e2e/visual.spec.ts
import { test, expect } from '@playwright/test'

const SCREENS = ['/signup', '/login', '/reset']

for (const path of SCREENS) {
  for (const theme of ['light', 'dark'] as const) {
    for (const locale of ['en', 'ar'] as const) {
      test(`${path} renders in ${theme} ${locale}`, async ({ page, context }) => {
        await context.addCookies([
          { name: 'aqd_locale', value: locale, url: 'http://localhost:3000' },
        ])
        await page.emulateMedia({ colorScheme: theme })
        await page.goto(path)
        await expect(page).toHaveScreenshot(`${path.slice(1)}-${theme}-${locale}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
        })
      })
    }
  }
}
```

- [ ] **Step 5: Generate baselines and run**

```bash
npx playwright test e2e/visual.spec.ts --update-snapshots
npm run e2e
```

Expected: PASS — 6 a11y tests, 12 visual tests. Review each new baseline image by eye before committing; a wrong baseline locks in a bug.

- [ ] **Step 6: Run everything**

```bash
npm test && npm run e2e
```

Expected: the full suite green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: add token, accessibility and visual regression audits"
```

---

## Known deferral

The spec's section 4 requires that **changing an email address re-verifies it and drops device trust.** No task above implements it, and that is deliberate rather than an oversight: sub-project 1 ships no account-settings screen, so there is no way to change an email address in this build and the behaviour has nothing to attach to.

It must ship in the same task as the settings screen that introduces email editing, in sub-project 5. The pieces it needs already exist by the end of this plan — `revoke_all_devices()` from Task 11 and the `signup_verify` code path from Task 10 — so it is a small addition, not a redesign. Do not build the email-change UI without it.

---

## Definition of Done

Sub-project 1 is complete when all of these hold:

- [ ] `npm test` and `npm run e2e` both pass with no skipped tests.
- [ ] `tests/db/isolation.test.ts` passes — the exit test from the spec.
- [ ] The parallel-verification race test in `tests/db/codes.test.ts` passes.
- [ ] The token audit reports zero colour literals outside `globals.css` and zero physical direction utilities.
- [ ] A human has walked signup → verify → onboarding → dashboard, then signed in from a second browser profile and been challenged.
- [ ] Password reset has been walked by hand and the previously trusted device is challenged afterwards.
- [ ] Every screen renders correctly in light and dark, English and Arabic.
- [ ] No occurrence of `SERVICE_ROLE` anywhere in `src/`.
