import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

const seenKey = 'code-sherpa.intro.seen.v1'
const motionQuery = '(prefers-reduced-motion: reduce)'

function shouldEnter() {
  try {
    if (window.matchMedia(motionQuery).matches) return false
    const seen = sessionStorage.getItem(seenKey)
    return new URLSearchParams(window.location.search).get('intro') === '1' || seen === null
  } catch {
    return false
  }
}

function markSeen() {
  try { sessionStorage.setItem(seenKey, '1') } catch {}
}

export default function CinematicEntrance({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(shouldEnter)
  const workspace = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const wasActive = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  function dismiss() {
    markSeen()
    setVisible(false)
  }

  useEffect(() => {
    const background = workspace.current
    if (!visible) {
      if (wasActive.current && background) {
        wasActive.current = false
        const target = background.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]') ?? background
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
      }
      return
    }

    wasActive.current = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    background?.setAttribute('inert', '')
    primary.current?.focus({ preventScroll: true })

    function close() {
      markSeen()
      setVisible(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLButtonElement>('button')
        if (!controls?.length) return
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (!dialog.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus({ preventScroll: true })
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus({ preventScroll: true })
        }
      }
    }
    function onFocus(event: FocusEvent) {
      if (!dialog.current?.contains(event.target as Node)) primary.current?.focus({ preventScroll: true })
    }
    const preference = window.matchMedia(motionQuery)
    function onMotionChange() { if (preference.matches) close() }
    if (preference.addEventListener) preference.addEventListener('change', onMotionChange)
    else preference.addListener?.(onMotionChange)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocus)
    const timer = window.setTimeout(close, 4200)
    onMotionChange()
    return () => {
      window.clearTimeout(timer)
      if (preference.removeEventListener) preference.removeEventListener('change', onMotionChange)
      else preference.removeListener?.(onMotionChange)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocus)
      background?.removeAttribute('inert')
      document.body.style.overflow = previousOverflow
    }
  }, [visible])

  return (
    <>
      <div ref={workspace} className={visible ? 'sherpa-entry-background' : undefined} aria-hidden={visible ? true : undefined}>
        {children}
      </div>
      {visible && (
        <div ref={dialog} className="sherpa-entry" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
          <button className="sherpa-entry-skip" type="button" onClick={dismiss}>Skip intro</button>
          <div className="sherpa-entry-scene">
            <svg className="sherpa-entry-summit" viewBox="0 0 720 280" fill="none" aria-hidden="true">
              <path className="sherpa-entry-ridge-back" d="M0 252 126 122 207 198 302 80 398 181 510 104 720 261" />
              <path className="sherpa-entry-ridge" d="M58 274 213 153 278 199 388 30 490 188 550 153 670 274" />
              <path className="sherpa-entry-snow" d="m350 89 38-59 42 65-30-15-17 12-12-17-21 14Z" />
              <path className="sherpa-entry-trail" pathLength="1" d="m269 275 67-42-23-30 55-35-20-26 40-47V30" />
              <path className="sherpa-entry-flag" d="M388 30V9l32 6-32 7" />
            </svg>
            <div className="sherpa-entry-copy">
              <p className="sherpa-entry-eyebrow">A clearer path to the summit</p>
              <h1 id={titleId}>code sherpa<span>.ai</span></h1>
              <p id={descriptionId} className="sherpa-entry-description">Write. Run. Understand.</p>
              <div className="sherpa-entry-console" aria-hidden="true">
                <span>solution.py</span>
                <code><span>def</span> climb(idea):<br />{'    '}return practice(idea)</code>
              </div>
              <button ref={primary} className="sherpa-entry-enter" type="button" onClick={dismiss}>
                Enter workspace <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}