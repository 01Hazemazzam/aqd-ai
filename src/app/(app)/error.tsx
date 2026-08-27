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
