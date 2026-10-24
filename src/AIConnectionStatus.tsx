import { useEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { isRequestCancelled, requestAIStatus } from './learningApi'

export function AIConnectionStatus() {
  const pending = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('OpenAI availability has not been checked.')
  useEffect(() => () => { pending.current?.abort() }, [])

  const check = async () => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setMessage('Checking OpenAI availability...')
    try {
      const status = await requestAIStatus(fetch, { signal: controller.signal })
      if (controller.signal.aborted) return
      setMessage(status.available
        ? `OpenAI ready: ${status.model}. AI requests still require your opt-in.`
        : [!status.configured && 'OpenAI needs a backend API key.', !status.enabled && 'The server must enable the paid AI flag.'].filter(Boolean).join(' '))
    } catch (error) {
      if (controller.signal.aborted || isRequestCancelled(error)) return
      setMessage('Could not check OpenAI availability. Check that the backend is running.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return <div className="ai-connection">
    <button type="button" className="hint-button" disabled={loading} onClick={() => { void check() }}><Activity size={14} />Check OpenAI availability</button>
    <p role="status" aria-label="OpenAI availability" aria-busy={loading}>{message}</p>
    <p className="plan-generation-note">Availability checks do not call a paid model. They check saved key presence and server enablement, not credential validity or billing. Use Run and test Python for separate browser-only execution.</p>
  </div>
}