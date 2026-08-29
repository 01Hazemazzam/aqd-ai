// Split out of analyze-actions.ts: a 'use server' file can only export async
// functions (Next.js server-action constraint), and these are deliberately
// synchronous -- pure, no I/O.
import { AiDisabledError, AiUpstreamError } from './router'

export interface TaskErrorInfo {
  disabled?: boolean
  upstreamStatus?: number
}

export function mapTaskError(err: unknown): TaskErrorInfo {
  return {
    disabled: err instanceof AiDisabledError,
    upstreamStatus: err instanceof AiUpstreamError ? err.status : undefined,
  }
}

export function classifyAnalysisError(runs: TaskErrorInfo[]): 'ai_disabled' | 'quota_exceeded' | 'unknown' {
  if (runs.some((r) => r.disabled)) return 'ai_disabled'
  if (runs.some((r) => r.upstreamStatus === 429)) return 'quota_exceeded'
  return 'unknown'
}
