import { validateProgress, type ProgressState } from './progress'
import type { ProgressStore } from './useLearningProgress'

export type AccountSession = {
  user: { id: string; email: string } | null
  csrf_token: string | null
  progress: ProgressState | null
  revision: number | null
  database_enabled: boolean
}
export class AccountApiError extends Error {
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}
type Options = { signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch }

export async function accountJson(path: string, method = 'GET', body?: unknown, csrf?: string, options: Options = {}): Promise<unknown> {
  const controller = new AbortController()
  let rejectCancellation!: (reason: Error) => void
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject })
  const cancel = () => {
    rejectCancellation(new AccountApiError('Account request cancelled.'))
    controller.abort()
  }
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  const timer = setTimeout(() => {
    rejectCancellation(new AccountApiError('Account request timed out. Please retry.'))
    controller.abort()
  }, options.timeoutMs ?? 15_000)
  try {
    return await Promise.race([cancelled, (async () => {
      if (controller.signal.aborted) throw new AccountApiError('Account request cancelled.')
      const response = await (options.fetcher ?? fetch)(path, {
        method, credentials: 'same-origin', signal: controller.signal,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!response.ok) throw new AccountApiError(`Account service returned ${response.status}. Please retry.`, response.status)
      return await response.json()
    })()])
  } catch (error) {
    if (error instanceof AccountApiError) throw error
    throw new AccountApiError('Account service is unavailable or returned invalid data. Please retry.')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export function progressSnapshot(value: unknown): { progress: ProgressState; revision: number } {
  if (!record(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new AccountApiError('Invalid account progress response.')
  const progress = validateProgress(value.progress)
  if (!progress) throw new AccountApiError('Invalid account progress response.')
  return { progress, revision: value.revision as number }
}
export function parseSession(value: unknown): AccountSession {
  if (!record(value) || typeof value.database_enabled !== 'boolean') throw new AccountApiError('Invalid account session response.')
  if (value.user === null && value.csrf_token === null && value.progress === null && value.revision === null) {
    return { user: null, csrf_token: null, progress: null, revision: null, database_enabled: value.database_enabled }
  }
  if (!record(value.user) || typeof value.user.id !== 'string' || !value.user.id || typeof value.user.email !== 'string' ||
      typeof value.csrf_token !== 'string' || !value.csrf_token || value.database_enabled !== true) throw new AccountApiError('Invalid account session response.')
  return { user: { id: value.user.id, email: value.user.email }, csrf_token: value.csrf_token, database_enabled: true, ...progressSnapshot(value) }
}

export type RemoteProgressStore = ProgressStore & {
  dispose(): void
  retry(): Promise<boolean>
  hasUnsaved(): boolean
}
export function createRemoteProgressStore(session: AccountSession, options: Options = {}): RemoteProgressStore {
  if (!session.user || !session.progress || session.revision === null || !session.csrf_token) throw new AccountApiError('Sign in before saving account progress.')
  let latest = session.progress
  let saved = JSON.stringify(latest)
  let revision = session.revision
  let disposed = false
  let locked = false
  let warning = ''
  let running: Promise<boolean> | null = null
  const controller = new AbortController()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  const run = (): Promise<boolean> => {
    if (disposed || locked) return Promise.resolve(false)
    if (running) return running
    if (saved === JSON.stringify(latest)) return Promise.resolve(true)
    running = (async () => {
      try {
        while (!disposed && saved !== JSON.stringify(latest)) {
          const progress = latest
          const result = progressSnapshot(await accountJson('/api/progress', 'PUT', { progress, revision }, session.csrf_token!, { ...options, signal: controller.signal }))
          if (disposed) return false
          revision = result.revision
          saved = JSON.stringify(progress)
        }
        warning = ''
        return !disposed
      } catch (error) {
        if (disposed) return false
        const status = error instanceof AccountApiError ? error.status : 0
        locked = true
        warning = status === 409 ? 'Unsaved progress: another session changed this account. Reload account progress to resolve the conflict.'
          : status === 401 ? 'Unsaved progress: your session expired. Sign in again to continue. Autosave is paused.'
          : 'Unsaved progress: account storage is unavailable. Autosave is paused; retry saving or reload account progress.'
        retryAllowed = status !== 409 && status !== 401
        return false
      } finally {
        running = null
        notify()
      }
    })()
    return running
  }
  let retryAllowed = false
  return {
    load: () => latest,
    save(progress) { latest = progress; return run() },
    getStatus: () => warning,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    hasUnsaved: () => saved !== JSON.stringify(latest),
    retry() {
      if (!retryAllowed || disposed) return Promise.resolve(false)
      locked = false
      warning = ''
      notify()
      return run()
    },
    dispose() {
      disposed = true
      controller.abort()
      warning = 'Account writes are paused. Reload account progress before continuing to save.'
      notify()
    },
  }
}