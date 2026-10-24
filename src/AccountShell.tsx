import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { LogIn, LogOut, RefreshCw, UserPlus } from 'lucide-react'
import App from './App'
import { accountJson, parseSession, createRemoteProgressStore, type AccountSession, type RemoteProgressStore } from './accountsApi'
import { localProgressStore, type ProgressStore } from './useLearningProgress'

type Workspace = { session: AccountSession; store: ProgressStore; key: string }
const remoteStore = (workspace: Workspace | null) => workspace?.session.user ? workspace.store as RemoteProgressStore : null

export default function AccountShell() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('Checking your account session...')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [storeWarning, setStoreWarning] = useState('')
  const password = useRef<HTMLInputElement | null>(null)
  const passwordRef = useCallback((node: HTMLInputElement | null) => {
    if (password.current && password.current !== node) password.current.value = ''
    password.current = node
  }, [])
  const current = useRef<Workspace | null>(null)
  const epoch = useRef(0)
  const operation = useRef<AbortController | null>(null)
  const attached = useRef(false)
  const busy = useRef(false)

  function install(session: AccountSession) {
    const next: Workspace = {
      session, store: session.user ? createRemoteProgressStore(session) : localProgressStore,
      key: `${session.user?.id ?? 'guest'}:${epoch.current}`,
    }
    current.current = next
    setWorkspace(next)
    setStoreWarning('')
  }

  useEffect(() => {
    attached.current = true
    const controller = new AbortController()
    const requestEpoch = ++epoch.current
    void accountJson('/api/auth/session', 'GET', undefined, undefined, { signal: controller.signal })
      .then(parseSession).then((session) => {
        if (controller.signal.aborted || requestEpoch !== epoch.current || !attached.current) return
        install(session)
        setMessage(session.user ? 'Signed in. Account progress loaded.' : session.database_enabled ? 'Guest session. Progress stays on this device.' : 'Accounts are unavailable: the database is disabled. Guest progress stays on this device.')
      }).catch(() => {
        if (!controller.signal.aborted && requestEpoch === epoch.current && attached.current) {
          install({ user: null, csrf_token: null, progress: null, revision: null, database_enabled: false })
          setMessage('Account service is unavailable. Guest mode is available on this device; reload account progress to retry.')
        }
      })
    return () => {
      attached.current = false
      controller.abort()
      if (password.current) password.current.value = ''
      queueMicrotask(() => {
        if (attached.current) return
        operation.current?.abort()
        remoteStore(current.current)?.dispose()
      })
    }
  }, [])

  useEffect(() => {
    const store = remoteStore(workspace)
    setStoreWarning(store?.getStatus?.() ?? '')
    return store?.subscribe?.(() => setStoreWarning(store.getStatus?.() ?? ''))
  }, [workspace])

  async function transition(kind: 'login' | 'register' | 'logout' | 'reload', credentials?: { email: string; password: string }) {
    if (busy.current) return
    const previous = current.current
    const store = remoteStore(previous)
    if (store?.hasUnsaved() && !window.confirm('This account has unsaved progress. Continuing may discard it. Continue?')) return
    busy.current = true
    const requestEpoch = ++epoch.current
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    store?.dispose()
    flushSync(() => { setPending(true); setWorkspace(null); setMessage(kind === 'logout' ? 'Signing out...' : 'Loading account...') })
    try {
      if (kind === 'logout') {
        const result = await accountJson('/api/auth/logout', 'POST', {}, previous?.session.csrf_token ?? undefined, { signal: controller.signal })
        if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true) throw new Error('Invalid logout response.')
      }
      const result = await accountJson(kind === 'login' || kind === 'register' ? `/api/auth/${kind}` : '/api/auth/session',
        kind === 'login' || kind === 'register' ? 'POST' : 'GET', credentials, undefined, { signal: controller.signal })
      const session = parseSession(result)
      if ((kind === 'login' || kind === 'register') && !session.user) throw new Error('Sign in was not confirmed by the server.')
      if (kind === 'logout' && session.user) throw new Error('The server still reports an active session. Reload your account.')
      if (controller.signal.aborted || requestEpoch !== epoch.current || !attached.current) return
      install(session)
      setMessage(session.user ? 'Signed in. Account progress loaded.' : session.database_enabled ? 'Signed out. Guest progress restored.' : 'Accounts are unavailable: the database is disabled. Guest progress stays on this device.')
    } catch (error) {
      if (controller.signal.aborted || requestEpoch !== epoch.current || !attached.current) return
      current.current = previous
      setWorkspace(previous)
      setMessage(`${error instanceof Error ? error.message : 'Account request failed.'}${previous?.session.user ? ' Your account remains open locally; writes are paused. Reload account progress to verify the session before saving.' : ''}`)
    } finally {
      if (requestEpoch === epoch.current && attached.current) { busy.current = false; setPending(false) }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const secret = password.current?.value ?? ''
    if (password.current) password.current.value = ''
    if (secret.length < 12 || secret.length > 128) { setMessage('Password must contain 12 to 128 characters.'); return }
    void transition(mode, { email: email.trim(), password: secret })
  }

  const panel = <section id="account-panel" className="account-panel" aria-labelledby="account-title" aria-busy={pending}>
    <div className="account-identity"><h2 id="account-title">{workspace?.session.user ? 'Your account' : 'Learner account'}</h2>
      {workspace?.session.user && <p>{workspace.session.user.email}</p>}
      <p role="status" aria-label="Account status">{message}</p>
      {storeWarning && <p role="alert">{storeWarning}</p>}
    </div>
    <div className="account-controls">
      {workspace?.session.user && <div className="account-actions">
        <button type="button" disabled={pending} onClick={() => void transition('logout')}><LogOut size={15} /> Sign out</button>
        <button type="button" disabled={pending} onClick={() => void remoteStore(workspace)?.retry()}><RefreshCw size={15} /> Retry saving</button>
      </div>}
      <button type="button" disabled={pending} onClick={() => void transition('reload')}><RefreshCw size={15} /> Reload account progress</button>
      {workspace?.session.database_enabled !== false && <form onSubmit={submit} aria-label="Account access">
        <fieldset disabled={pending}><legend>{workspace?.session.user ? 'Switch account' : 'Sign in or register'}</legend>
          <div className="account-modes" role="group" aria-label="Account access mode">
            <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); if (password.current) password.current.value = '' }}>Sign in</button>
            <button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); if (password.current) password.current.value = '' }}>Register</button>
          </div>
          <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input ref={passwordRef} name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} /></label>
          <button type="submit">{mode === 'register' ? <UserPlus size={15} /> : <LogIn size={15} />}{mode === 'register' ? 'Create account' : 'Continue'}</button>
        </fieldset>
      </form>}
    </div>
  </section>

  return workspace && !pending
    ? <App accountKey={workspace.key} progressStore={workspace.store} accountPanel={panel}
      progressDescription={workspace.session.user ? 'Saved to your PostgreSQL account. Guest progress remains separate on this device.' : undefined} />
    : <main className="account-loading">{panel}</main>
}