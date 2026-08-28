import { useTranslations } from 'next-intl'

/**
 * A line-art illustration of clause cards fanned behind one another, with a
 * risk marker on the front card -- the "read every clause, miss nothing"
 * promise, drawn rather than stated. Colours are all var() references into
 * the theme tokens (never raw), so it adapts automatically across light and
 * dark. Purely decorative: hidden from assistive tech.
 */
function ClauseIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 260"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g transform="rotate(-7 160 130)">
        <rect x="52" y="46" width="188" height="150" rx="10" fill="var(--surface)" stroke="var(--edge)" strokeWidth="1.5" />
      </g>
      <g transform="rotate(4 160 130)">
        <rect x="60" y="40" width="188" height="150" rx="10" fill="var(--surface-2)" stroke="var(--edge)" strokeWidth="1.5" />
      </g>
      <rect x="56" y="52" width="196" height="156" rx="10" fill="var(--surface-2)" stroke="var(--edge)" strokeWidth="1.5" />

      <line x1="80" y1="82" x2="204" y2="82" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />
      <line x1="80" y1="98" x2="228" y2="98" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />
      <line x1="80" y1="114" x2="180" y2="114" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />

      <line x1="80" y1="144" x2="212" y2="144" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />
      <line x1="80" y1="160" x2="192" y2="160" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />

      <circle cx="228" cy="152" r="15" fill="var(--surface)" stroke="var(--risk-high)" strokeWidth="2" />
      <path d="M228 145.5 228.1 152.5" stroke="var(--risk-high)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="228.1" cy="158.5" r="1.4" fill="var(--risk-high)" />
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
          <p className="text-balance font-serif text-2xl font-medium leading-snug text-ink">
            {t('tagline')}
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-sm text-ink-dim">
            <li className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-accent">✓</span>
              {t('feature1')}
            </li>
            <li className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-accent">✓</span>
              {t('feature2')}
            </li>
            <li className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-accent">✓</span>
              {t('feature3')}
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
