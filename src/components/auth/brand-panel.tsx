'use client'
import { useTranslations } from 'next-intl'
import { motion } from 'motion/react'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/reveal'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

const LINES = [
  { x1: 80, y1: 82, x2: 204, y2: 82 },
  { x1: 80, y1: 98, x2: 228, y2: 98 },
  { x1: 80, y1: 114, x2: 180, y2: 114 },
  { x1: 80, y1: 144, x2: 212, y2: 144 },
  { x1: 80, y1: 160, x2: 192, y2: 160 },
]
const LINES_START = 0.5
const LINES_STEP = 0.12

/**
 * A line-art illustration of clause cards fanned behind one another, with a
 * risk marker on the front card -- the "read every clause, miss nothing"
 * promise, drawn rather than stated. Colours are all var() references into
 * the theme tokens (never raw), so it adapts automatically across light and
 * dark. The clause lines draw in on mount like text being scanned, and the
 * risk marker pops in once the "reading" reaches it, then holds a slow
 * breathing pulse -- flagged, and being watched. Purely decorative: hidden
 * from assistive tech.
 */
function ClauseIllustration({ className }: { className?: string }) {
  const markerDelay = LINES_START + LINES.length * LINES_STEP + 0.1

  return (
    <svg viewBox="0 0 320 260" fill="none" className={className} aria-hidden="true">
      <motion.g
        initial={{ opacity: 0, scale: 0.94, rotate: -7 }}
        animate={{ opacity: 1, scale: 1, rotate: -7 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
        style={{ transformOrigin: '160px 130px', transformBox: 'view-box' }}
      >
        <rect x="52" y="46" width="188" height="150" rx="10" fill="var(--surface)" stroke="var(--edge)" strokeWidth="1.5" />
      </motion.g>
      <motion.g
        initial={{ opacity: 0, scale: 0.94, rotate: 4 }}
        animate={{ opacity: 1, scale: 1, rotate: 4 }}
        transition={{ duration: 0.6, delay: 0.08, ease: EASE_OUT }}
        style={{ transformOrigin: '160px 130px', transformBox: 'view-box' }}
      >
        <rect x="60" y="40" width="188" height="150" rx="10" fill="var(--surface-2)" stroke="var(--edge)" strokeWidth="1.5" />
      </motion.g>

      <motion.rect
        x="56"
        width="196"
        height="156"
        rx="10"
        fill="var(--surface-2)"
        stroke="var(--edge)"
        strokeWidth="1.5"
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 52 }}
        transition={{ duration: 0.6, delay: 0.16, ease: EASE_OUT }}
      />

      {LINES.map((l, i) => (
        <motion.line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke="var(--ink-faint)"
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: LINES_START + i * LINES_STEP, ease: EASE_OUT }}
        />
      ))}

      <motion.g
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: markerDelay, ease: [0.34, 1.56, 0.64, 1] }}
        style={{ transformOrigin: '228px 152px', transformBox: 'view-box' }}
      >
        <motion.circle
          cx="228"
          cy="152"
          r="15"
          fill="var(--surface)"
          stroke="var(--risk-high)"
          strokeWidth="2"
          animate={{ scale: [1, 1.12, 1], opacity: [1, 0.8, 1] }}
          transition={{ duration: 2.4, delay: markerDelay + 0.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '228px 152px', transformBox: 'view-box' }}
        />
        <path d="M228 145.5 228.1 152.5" stroke="var(--risk-high)" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="228.1" cy="158.5" r="1.4" fill="var(--risk-high)" />
      </motion.g>
    </svg>
  )
}

export function BrandPanel() {
  const t = useTranslations('auth.brand')

  return (
    <div className="relative hidden overflow-hidden bg-surface-3 lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 22% 18%, color-mix(in oklch, var(--accent) 16%, transparent) 0%, transparent 42%),' +
            'radial-gradient(circle at 82% 78%, color-mix(in oklch, var(--brass) 14%, transparent) 0%, transparent 48%)',
        }}
      />

      <div className="relative flex flex-1 flex-col justify-between">
        <ClauseIllustration className="w-full max-w-sm self-center" />

        <div>
          <FadeIn delay={0.15}>
            <p className="text-balance font-serif text-2xl font-medium leading-snug text-ink">
              {t('tagline')}
            </p>
          </FadeIn>
          <StaggerList className="mt-8 flex flex-col gap-3 text-sm text-ink-dim">
            <StaggerItem className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-accent">✓</span>
              {t('feature1')}
            </StaggerItem>
            <StaggerItem className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-accent">✓</span>
              {t('feature2')}
            </StaggerItem>
            <StaggerItem className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-accent">✓</span>
              {t('feature3')}
            </StaggerItem>
          </StaggerList>
        </div>
      </div>
    </div>
  )
}
