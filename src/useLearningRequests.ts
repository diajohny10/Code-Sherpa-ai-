import { useEffect, useRef } from 'react'

type RequestKind = 'plan' | 'hints' | 'mentor'

export function useLearningRequests() {
  const pending = useRef<Partial<Record<RequestKind, AbortController>>>({})
  const invalidate = () => {
    Object.values(pending.current).forEach((controller) => controller.abort())
    pending.current = {}
  }
  const start = (kind: RequestKind) => {
    pending.current[kind]?.abort()
    const controller = new AbortController()
    pending.current[kind] = controller
    return controller.signal
  }
  useEffect(() => invalidate, [])
  return { start, invalidate }
}