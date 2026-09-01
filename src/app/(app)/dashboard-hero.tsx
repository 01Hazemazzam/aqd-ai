'use client'
import { useRef } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { motion } from 'motion/react'
import { FileText, ShieldAlert, ArrowUpRight } from 'lucide-react'
import { UploadZone } from './contracts/upload-zone'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

// Gauge geometry: a 12 o'clock-start ring standing in for Aurora's "two thin
// orbital rings" -- RING_R is the coverage arc read against the outer tick
// ring, TICK_COUNT gives it a dial face rather than a bare circle.
const RING_R = 104
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R
const TICK_COUNT = 12

// Rounded to 2dp: Math.cos/sin can differ in the last couple of ULPs between
// the server's V8 and the browser's, which otherwise serializes into two
// different attribute strings and trips a hydration mismatch on every tick.
function polar(radius: number, degrees: number) {
  const rad = ((degrees - 90) * Math.PI) / 180
  return {
    x: Math.round((160 + radius * Math.cos(rad)) * 100) / 100,
    y: Math.round((160 + radius * Math.sin(rad)) * 100) / 100,
  }
}

/**
 * The "signal instrument," reimagined as a coverage gauge: an outer dial
 * ring (slow continuous rotation, like Aurora's orbital rings), an inner
 * progress ring reading real analysis coverage, and a brass needle pointing
 * at that same number -- one object, not a cluster of cards. Two status
 * nodes (contracts / high-risk flags) and a forecast readout hang off it,
 * all real org data, nothing invented.
 */
function CoverageInstrument({
  total,
  ready,
  highRisk,
}: {
  total: number
  ready: number
  highRisk: number
}) {
  const t = useTranslations('dashboard')
  const coverage = total > 0 ? Math.round((ready / total) * 100) : null
  const pending = Math.max(total - ready, 0)
  const needleAngle = coverage !== null ? (coverage / 100) * 360 : 0
  const dashOffset = RING_CIRCUMFERENCE * (1 - (coverage ?? 0) / 100)

  return (
    <div className="mx-auto flex w-full max-w-[360px] flex-col items-center">
      <div className="relative aspect-square w-full">
        <div
          aria-hidden="true"
          className="absolute inset-[12%] rounded-full opacity-70 blur-3xl"
          style={{ background: 'radial-gradient(circle, color-mix(in oklch, var(--accent) 28%, transparent) 0%, transparent 70%)' }}
        />

        <svg viewBox="0 0 320 320" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <motion.g
            animate={{ rotate: 360 }}
            transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: '160px 160px', transformBox: 'view-box' }}
          >
            <circle cx="160" cy="160" r="140" fill="none" stroke="var(--edge)" strokeWidth="1" />
            {Array.from({ length: TICK_COUNT }, (_, i) => {
              const deg = (360 / TICK_COUNT) * i
              const a = polar(140, deg)
              const b = polar(131, deg)
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--ink-faint)" strokeWidth="1.5" strokeLinecap="round" />
            })}
          </motion.g>

          <circle cx="160" cy="160" r={RING_R} fill="none" stroke="var(--edge)" strokeWidth="6" opacity="0.5" />
          {coverage !== null && (
            <motion.circle
              cx="160"
              cy="160"
              r={RING_R}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
              animate={{ strokeDashoffset: dashOffset }}
              transition={{ duration: 1, delay: 0.4, ease: EASE_OUT }}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '160px 160px', transformBox: 'view-box' }}
            />
          )}

          {coverage !== null && (
            <motion.g
              initial={{ rotate: 0 }}
              animate={{ rotate: needleAngle }}
              transition={{ duration: 1, delay: 0.4, ease: EASE_OUT }}
              style={{ transformOrigin: '160px 160px', transformBox: 'view-box' }}
            >
              <line x1="160" y1="160" x2="160" y2="72" stroke="var(--brass)" strokeWidth="2" strokeLinecap="round" />
            </motion.g>
          )}
          <circle cx="160" cy="160" r="5" fill="var(--brass)" />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-serif text-5xl font-medium tabular-nums text-ink">
            {coverage !== null ? `${coverage}%` : '—'}
          </span>
          <span className="mt-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
            {coverage !== null ? t('stats.readyContracts') : t('instrument.emptyCaption')}
          </span>
        </div>

        <div className="absolute -top-2 end-0 flex items-center gap-1.5 rounded-full border border-edge bg-surface-2 py-1 ps-1.5 pe-2.5 shadow-sm">
          <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-accent">
            <FileText size={12} strokeWidth={2.25} />
          </span>
          <span className="text-xs font-semibold tabular-nums text-ink">{total}</span>
          <span className="text-xs text-ink-faint">{t('stats.totalContracts')}</span>
        </div>

        <div className="absolute bottom-2 start-0 flex items-center gap-1.5 rounded-full border border-edge bg-surface-2 py-1 ps-1.5 pe-2.5 shadow-sm">
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-full text-risk-high"
            style={{ backgroundColor: 'color-mix(in oklch, var(--risk-high) 14%, var(--surface-2))' }}
          >
            <ShieldAlert size={12} strokeWidth={2.25} />
          </span>
          <span className="text-xs font-semibold tabular-nums text-ink">{highRisk}</span>
          <span className="text-xs text-ink-faint">{t('instrument.highRisk')}</span>
        </div>
      </div>

      {total > 0 && (
        <p className="mt-5 text-xs text-ink-faint">
          {pending > 0 ? t('instrument.pending', { count: pending }) : t('instrument.allAnalyzed')}
        </p>
      )}
    </div>
  )
}

export function DashboardHero({
  total,
  ready,
  highRisk,
  lastAnalysis,
}: {
  total: number
  ready: number
  highRisk: number
  lastAnalysis: string | null
}) {
  const t = useTranslations('dashboard')
  const glowRef = useRef<HTMLDivElement>(null)

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    if (glowRef.current) {
      glowRef.current.style.background =
        `radial-gradient(circle at ${x}% ${y}%, color-mix(in oklch, var(--accent) 9%, transparent) 0%, transparent 45%),` +
        `radial-gradient(circle at 85% 15%, color-mix(in oklch, var(--brass) 8%, transparent) 0%, transparent 40%)`
    }
  }

  const railItems = [
    { label: t('stats.totalContracts'), value: String(total) },
    { label: t('stats.readyContracts'), value: String(ready) },
    { label: t('instrument.highRisk'), value: String(highRisk) },
    { label: t('rail.lastAnalysis'), value: lastAnalysis ?? t('rail.never') },
  ]

  return (
    <main className="relative overflow-hidden" onPointerMove={handlePointerMove}>
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] transition-[background] duration-500 ease-out"
        style={{
          background:
            'radial-gradient(circle at 15% 0%, color-mix(in oklch, var(--accent) 10%, transparent) 0%, transparent 45%),' +
            'radial-gradient(circle at 85% 15%, color-mix(in oklch, var(--brass) 10%, transparent) 0%, transparent 40%)',
        }}
      />

      <div className="mx-auto max-w-5xl px-6 pb-16 pt-16 sm:px-10 sm:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          <div>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
              className="text-xs font-semibold uppercase tracking-[0.14em] text-accent"
            >
              {t('kicker')}
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.08, ease: EASE_OUT }}
              className="mt-3 text-balance font-serif text-4xl font-medium leading-[1.1] tracking-tight text-ink sm:text-5xl"
            >
              {t('headline')}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.16, ease: EASE_OUT }}
              className="mt-4 max-w-md text-pretty text-base leading-relaxed text-ink-dim"
            >
              {t('lede')}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.24, ease: EASE_OUT }}
              className="mt-8 flex flex-wrap items-center gap-4"
            >
              <UploadZone />
              <Link
                href="/contracts"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline decoration-edge underline-offset-4 transition-colors hover:decoration-ink"
              >
                {t('viewContracts')}
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.92, rotate: -4 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: EASE_OUT }}
          >
            <CoverageInstrument total={total} ready={ready} highRisk={highRisk} />
          </motion.div>
        </div>
      </div>

      <div className="hidden border-t border-edge sm:block">
        <div className="mx-auto grid max-w-5xl grid-cols-4 gap-6 px-6 py-5 sm:px-10">
          {railItems.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <span className="truncate text-xs uppercase tracking-wide text-ink-faint">{item.label}</span>
              <span className="text-sm font-medium tabular-nums text-ink">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
