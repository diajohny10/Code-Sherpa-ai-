import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AccountShell from '../src/AccountShell'
import { AccountApiError, accountJson, createRemoteProgressStore, type AccountSession } from '../src/accountsApi'
import { PROGRESS_KEY, createEmptyProgress } from '../src/progress'

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status })
const guest: AccountSession = { user: null, csrf_token: null, progress: null, revision: null, database_enabled: true }
const signed = (id = 'first', xp = 40): AccountSession => ({ user: { id, email: `${id}@example.com` }, csrf_token: `csrf-${id}`, progress: { ...createEmptyProgress(), xp }, revision: 7, database_enabled: true })
function deferred<T = Response>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function flush() { await act(async () => { await Promise.resolve() }) }
function mount() { return render(<StrictMode><AccountShell /></StrictMode>) }
function credentials() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'first@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password-123' } })
}
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'Account access' })) }
function earnHint() { fireEvent.click(screen.getByRole('button', { name: 'Reveal hint 1' })) }

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('waits for signed-in session hydration, never loads or writes guest progress, and survives StrictMode', async () => {
  const delayed = deferred()
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...createEmptyProgress(), xp: 900 }))
  const before = localStorage.getItem(PROGRESS_KEY)
  const fetcher = vi.fn(() => delayed.promise.then((response) => response.clone()))
  vi.stubGlobal('fetch', fetcher)
  mount()
  expect(screen.queryByLabelText('Programming prompt')).toBeNull()
  await act(async () => { delayed.resolve(json(signed())) })
  expect(screen.getByLabelText('Programming prompt')).toBeTruthy()
  expect(screen.getByText('40 XP')).toBeTruthy()
  expect(localStorage.getItem(PROGRESS_KEY)).toBe(before)
  expect(fetcher.mock.calls.every((call) => call[0] === '/api/auth/session')).toBe(true)
})

it.each(['login', 'register'] as const)('supports %s without persisting credentials and restores prior guest progress on logout', async (kind) => {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...createEmptyProgress(), xp: 90 }))
  let session = guest
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith(`/${kind}`)) { session = signed(); return json(session) }
    if (path.endsWith('/logout')) { expect(init?.headers).toEqual(expect.objectContaining({ 'X-CSRF-Token': 'csrf-first' })); session = guest; return json({ ok: true }) }
    return json(session)
  })
  vi.stubGlobal('fetch', fetcher)
  mount(); await flush()
  const guestData = localStorage.getItem(PROGRESS_KEY)
  if (kind === 'register') fireEvent.click(screen.getByRole('button', { name: 'Register' }))
  credentials()
  const password = screen.getByLabelText('Password') as HTMLInputElement
  submit()
  expect(password.value).toBe('')
  await flush()
  expect(screen.getByText('first@example.com')).toBeTruthy()
  expect(screen.getByText('40 XP')).toBeTruthy()
  expect(localStorage.length).toBe(1)
  expect(localStorage.getItem(PROGRESS_KEY)).toBe(guestData)
  const auth = fetcher.mock.calls.find(([path]) => path.endsWith(`/${kind}`))!
  expect(JSON.parse(auth[1]!.body as string)).toEqual({ email: 'first@example.com', password: 'a-long-password-123' })
  expect(auth[1]?.credentials).toBe('same-origin')
  expect(auth[1]?.headers).not.toHaveProperty('Origin')
  expect(auth[1]?.headers).not.toHaveProperty('Authorization')
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); await flush()
  expect(screen.getByText('90 XP')).toBeTruthy()
  expect(localStorage.getItem(PROGRESS_KEY)).toBe(guestData)
})

it('clears password on failed submission and validates length without a request', async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith('/session') ? json(guest) : json({ detail: 'Invalid credentials' }, 401))
  vi.stubGlobal('fetch', fetcher)
  mount(); await flush(); credentials(); submit(); await flush()
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('status', { name: 'Account status' }).textContent).toContain('401')
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } }); submit()
  expect(screen.getByRole('status', { name: 'Account status' }).textContent).toContain('12 to 128')
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/login'))).toHaveLength(1)
})

it('serializes delayed saves and uses each returned revision, without writes from StrictMode hydration', async () => {
  const first = deferred()
  const writes: { progress: ReturnType<typeof createEmptyProgress>; revision: number }[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/session')) return json(signed())
    writes.push(JSON.parse(init!.body as string))
    return writes.length === 1 ? first.promise : json({ progress: writes.at(-1)!.progress, revision: 9 })
  }))
  mount(); await flush()
  expect(writes).toHaveLength(0)
  earnHint(); await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Reveal hint 2' })); await flush()
  expect(writes).toHaveLength(1)
  expect(writes[0].revision).toBe(7)
  await act(async () => { first.resolve(json({ progress: writes[0].progress, revision: 8 })) })
  expect(writes).toHaveLength(2)
  expect(writes[1].revision).toBe(8)
  expect(writes[1].progress.hintsUsed).toBe(2)
  expect(localStorage.length).toBe(0)
})

it.each([409, 401, 429, 503])('announces %s saves, blocks automatic overwrites, and offers deliberate recovery', async (status) => {
  let writes = 0
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/session')) return json(signed())
    if (init?.method === 'PUT') { writes++; return json({ detail: 'Unavailable' }, status) }
    return json(signed())
  })
  vi.stubGlobal('fetch', fetcher)
  mount(); await flush(); earnHint(); await flush()
  expect(screen.getByRole('alert').textContent).toContain(status === 409 ? 'another session' : status === 401 ? 'session expired' : 'storage is unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Reveal hint 2' })); await flush()
  expect(writes).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' })); await flush()
  expect(writes).toBe(status === 409 || status === 401 ? 1 : 2)
  vi.mocked(window.confirm).mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Reload account progress' })); await flush()
  expect(screen.getByRole('button', { name: 'Reveal hint 3' })).toBeTruthy()
  vi.mocked(window.confirm).mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Reload account progress' })); await flush()
  expect(screen.getByRole('button', { name: 'Reveal hint 1' })).toBeTruthy()
  expect(writes).toBe(status === 409 || status === 401 ? 1 : 2)
})

it('does not let a pending startup session override explicit login', async () => {
  const initial = deferred()
  vi.stubGlobal('fetch', vi.fn((path: string) => path.endsWith('/session') ? initial.promise : Promise.resolve(json(signed('second', 60)))))
  mount(); credentials(); submit(); await flush()
  expect(screen.getByText('second@example.com')).toBeTruthy()
  await act(async () => { initial.resolve(json(signed('first', 10))) })
  expect(screen.getByText('second@example.com')).toBeTruthy()
  expect(screen.queryByText('first@example.com')).toBeNull()
})

it('freezes learning and saves on account switch even when fetch ignores abort', async () => {
  const learning = deferred()
  const saving = deferred()
  let learningSignal: AbortSignal | undefined
  let savingSignal: AbortSignal | undefined
  const writes: RequestInit[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/session')) return json(signed())
    if (path.endsWith('/login')) return json(signed('second', 80))
    if (path.endsWith('/plan')) { learningSignal = init?.signal as AbortSignal; return learning.promise }
    writes.push(init!); savingSignal = init?.signal as AbortSignal; return saving.promise
  }))
  mount(); await flush()
  fireEvent.click(screen.getByRole('button', { name: /Build requirements/ })); earnHint(); await flush()
  credentials(); submit()
  expect(learningSignal?.aborted).toBe(true)
  expect(savingSignal?.aborted).toBe(true)
  await flush()
  await act(async () => {
    learning.resolve(json({})); saving.resolve(json({ progress: createEmptyProgress(), revision: 8 }))
  })
  expect(screen.getByText('second@example.com')).toBeTruthy()
  expect(screen.getByText('80 XP')).toBeTruthy()
  expect(writes).toHaveLength(1)
  expect(writes[0].headers).toEqual(expect.objectContaining({ 'X-CSRF-Token': 'csrf-first' }))
  expect(screen.queryByText(/Showing the local demo plan/)).toBeNull()
})

it('keeps the account on failed logout, pauses writes, then reloads a usable store', async () => {
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/logout')) return json({ detail: 'Unavailable' }, 503)
    if (init?.method === 'PUT') { writes++; return json({ progress: JSON.parse(init.body as string).progress, revision: 8 }) }
    return json(signed())
  }))
  mount(); await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); await flush()
  expect(screen.getByText('first@example.com')).toBeTruthy()
  expect(screen.getByRole('status', { name: 'Account status' }).textContent).toContain('writes are paused')
  earnHint(); await flush(); expect(writes).toBe(0)
  vi.mocked(window.confirm).mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Reload account progress' })); await flush()
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('unsaved progress'))
  earnHint(); await flush(); expect(writes).toBe(1)
})

it('keeps database-disabled guest mode usable and hides unavailable auth controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...guest, database_enabled: false })))
  mount(); await flush()
  expect(screen.getByRole('status', { name: 'Account status' }).textContent).toContain('database is disabled')
  expect(screen.queryByLabelText('Password')).toBeNull()
  earnHint(); await flush()
  expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!).hintsUsed).toBe(1)
})

it('keeps guest learning available when the initial backend session request fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
  mount(); await flush()
  expect(screen.getByLabelText('Programming prompt')).toBeTruthy()
  expect(screen.getByRole('status', { name: 'Account status' }).textContent).toContain('Account service is unavailable')
  earnHint(); await flush()
  expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!).hintsUsed).toBe(1)
  expect(screen.getByRole('button', { name: 'Reload account progress' })).toBeTruthy()
})

it('clears an unsubmitted password from its detached input on unmount', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(guest)))
  const view = mount(); await flush(); credentials()
  const input = screen.getByLabelText('Password') as HTMLInputElement
  expect(input.value).toBe('a-long-password-123')
  view.unmount()
  expect(input.value).toBe('')
  expect(localStorage.getItem(PROGRESS_KEY)).not.toContain('password')
})

it('bounds fetch and response-body timeouts and cancellation even with uncooperative fetch', async () => {
  vi.useFakeTimers()
  const never = new Promise<Response>(() => {})
  const fetchTimeout = accountJson('/api/auth/session', 'GET', undefined, undefined, { fetcher: vi.fn(() => never), timeoutMs: 10 })
  const fetchCheck = expect(fetchTimeout).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(10); await fetchCheck
  const bodyTimeout = accountJson('/api/auth/session', 'GET', undefined, undefined, { fetcher: vi.fn(async () => ({ ok: true, json: () => never }) as unknown as Response), timeoutMs: 10 })
  const bodyCheck = expect(bodyTimeout).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(10); await bodyCheck
  const controller = new AbortController()
  const cancelled = accountJson('/api/auth/session', 'GET', undefined, undefined, { fetcher: vi.fn(() => never), signal: controller.signal })
  controller.abort()
  await expect(cancelled).rejects.toBeInstanceOf(AccountApiError)
})

it('disposes the remote store on real unmount, but not simulated StrictMode cleanup', async () => {
  const pending = deferred()
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/session')) return json(signed())
    signal = init?.signal as AbortSignal; return pending.promise
  }))
  const view = mount(); await flush(); earnHint(); await flush()
  expect(signal?.aborted).toBe(false)
  view.unmount(); await flush()
  expect(signal?.aborted).toBe(true)
})

it('does not send queued revisions after a disposed store resolves', async () => {
  const delayed = deferred()
  const fetcher = vi.fn(() => delayed.promise)
  const store = createRemoteProgressStore(signed(), { fetcher })
  const first = store.save({ ...createEmptyProgress(), xp: 41 })
  const second = store.save({ ...createEmptyProgress(), xp: 42 })
  store.dispose()
  delayed.resolve(json({ progress: { ...createEmptyProgress(), xp: 41 }, revision: 8 }))
  expect(await first).toBe(false); expect(await second).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})