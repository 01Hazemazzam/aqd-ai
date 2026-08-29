'use client'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AuthError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span aria-hidden="true" className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-risk-high/10 text-risk-high">
          <AlertTriangle size={22} />
        </span>
        <h1 className="mb-2 font-serif text-2xl text-ink">Something went wrong</h1>
        <p className="mb-6 text-sm text-ink-dim">
          We couldn&apos;t load this page. Your account is unaffected.
        </p>
        <Button onClick={reset} icon={<RotateCw size={14} aria-hidden="true" />}>Try again</Button>
      </div>
    </div>
  )
}
