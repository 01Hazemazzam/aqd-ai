import { ChallengeForm } from './challenge-form'
import { DevCodeHint } from '@/components/auth/dev-code-hint'

// Server wrapper so the (dev-only) code hint can be fetched server-side and
// handed to the client form. In production DevCodeHint renders nothing.
export default function ChallengePage() {
  return <ChallengeForm devHint={<DevCodeHint purpose="device_challenge" />} />
}
