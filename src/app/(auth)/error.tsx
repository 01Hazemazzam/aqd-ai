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
