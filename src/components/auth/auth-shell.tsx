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
