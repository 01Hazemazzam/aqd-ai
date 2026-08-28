import { Suspense } from 'react'
import { VerifyForm } from './verify-form'
import { DevCodeHint } from '@/components/auth/dev-code-hint'

// Server wrapper so the (dev-only) code hint can be fetched server-side and
// handed to the client form. In production DevCodeHint renders nothing.
// VerifyForm reads useSearchParams, so it sits under Suspense.
export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm devHint={<DevCodeHint purpose="signup_verify" />} />
    </Suspense>
  )
}
