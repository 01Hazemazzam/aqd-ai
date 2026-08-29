'use client'
import Link from 'next/link'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-risk-high/10 text-risk-high">
        <AlertTriangle size={22} />
      </span>
      <h1 className="font-serif text-2xl text-ink">Something went wrong</h1>
      <p className="text-sm text-ink-dim">This page failed to load. Nothing was lost.</p>
      <div className="flex gap-2">
        <Button onClick={reset} icon={<RotateCw size={14} aria-hidden="true" />}>Try again</Button>
        <Link href="/login"><Button variant="secondary">Sign in again</Button></Link>
      </div>
    </div>
  )
}
