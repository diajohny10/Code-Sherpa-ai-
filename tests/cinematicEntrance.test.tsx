import { StrictMode, useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CinematicEntrance from '../src/CinematicEntrance'

const seenKey = 'code-sherpa.intro.seen.v1'
let preference: MediaQueryList
let listeners: Set<EventListenerOrEventListenerObject>

function motionChange(matches: boolean) {
  Object.defineProperty(preference, 'matches', { configurable: true, value: matches })
  act(() => listeners.forEach((listener) => {
    const event = new Event('change')
    if (typeof listener === 'function') listener(event)
    else listener.handleEvent(event)
  }))
}

function Workspace({ mounted = () => {}, unmounted = () => {} }: { mounted?: () => void; unmounted?: () => void }) {
  const [source, setSource] = useState('print("summit")')
  useEffect(() => { mounted(); return unmounted }, [])
  return <main><h1>Workspace</h1><input aria-label="Source" value={source} onChange={(event) => setSource(event.target.value)} /><button>Run</button></main>
}

function enter() { return screen.getByRole('button', { name: 'Enter workspace' }) }
function renderEntry() { return render(<CinematicEntrance><Workspace /></CinematicEntrance>) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
  listeners = new Set()
  preference = {
    matches: false, media: '(prefers-reduced-motion: reduce)', onchange: null,
    addEventListener: vi.fn((_name, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_name, listener) => listeners.delete(listener)),
  } as unknown as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => preference))
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected fetch') }))
  vi.stubGlobal('Worker', vi.fn(() => { throw new Error('Unexpected worker') }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.style.overflow = ''
})

it('shows an accessible dialog, focuses entry and hides the mounted workspace', () => {
  const view = renderEntry()
  const modal = screen.getByRole('dialog', { name: 'code sherpa.ai' })
  expect(modal.getAttribute('aria-modal')).toBe('true')
  expect(modal.getAttribute('aria-describedby')).toBe(screen.getByText('Write. Run. Understand.').id)
  expect(document.activeElement).toBe(enter())
  expect(screen.queryByRole('heading', { name: 'Workspace' })).toBeNull()
  expect(view.container.querySelector('[inert]')?.getAttribute('aria-hidden')).toBe('true')
  expect(view.container.querySelector('[inert]')?.className).toBe('sherpa-entry-background')
  expect(view.container.querySelector('input')?.value).toBe('print("summit")')
  expect(document.body.style.overflow).toBe('hidden')
})

it('closes at exactly 4.2 seconds without a backend and restores heading focus without scrolling', () => {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  renderEntry()
  act(() => vi.advanceTimersByTime(4199))
  expect(screen.queryByRole('dialog')).not.toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.queryByRole('dialog')).toBeNull()
  const heading = screen.getByRole('heading', { name: 'Workspace' })
  expect(document.activeElement).toBe(heading)
  expect(heading.getAttribute('tabindex')).toBe('-1')
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
  expect(sessionStorage.getItem(seenKey)).toBe('1')
  expect(document.body.style.overflow).toBe('')
  expect(vi.getTimerCount()).toBe(0)
  expect(fetch).not.toHaveBeenCalled()
  expect(Worker).not.toHaveBeenCalled()
})

it.each(['Enter workspace', 'Skip intro', 'Escape'])('dismisses immediately with %s', (action) => {
  const view = renderEntry()
  if (action === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
  else fireEvent.click(screen.getByRole('button', { name: action }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(view.container.querySelector('[inert], [aria-hidden="true"]')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Workspace' }))
  expect(sessionStorage.getItem(seenKey)).toBe('1')
  expect(vi.getTimerCount()).toBe(0)
})

it('traps Tab in both directions and redirects programmatic background focus', () => {
  renderEntry()
  const primary = enter()
  const skip = screen.getByRole('button', { name: 'Skip intro' })
  fireEvent.keyDown(primary, { key: 'Tab' })
  expect(document.activeElement).toBe(skip)
  fireEvent.keyDown(skip, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(primary)
  const source = screen.getByLabelText('Source')
  act(() => source.focus())
  expect(document.activeElement).toBe(primary)
})

it('skips initial reduced motion without stealing focus or adding a timer', () => {
  motionChange(true)
  const existing = document.createElement('button')
  document.body.append(existing)
  existing.focus()
  const view = renderEntry()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(existing)
  expect(view.container.querySelector('[inert], [aria-hidden]')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  existing.remove()
})

it('dismisses if reduced motion is enabled while active and removes its listener', () => {
  renderEntry()
  motionChange(true)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(listeners.size).toBe(0)
  expect(sessionStorage.getItem(seenKey)).toBe('1')
  expect(vi.getTimerCount()).toBe(0)
})

it('does not show again in the session, including a fresh wrapper mount', () => {
  const view = renderEntry()
  fireEvent.click(enter())
  view.unmount()
  renderEntry()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('skips an already-seen session without stealing focus', () => {
  sessionStorage.setItem(seenKey, '1')
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  renderEntry()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(focus).not.toHaveBeenCalled()
})

it('replays on the explicit preview URL without reopening after dismissal', () => {
  sessionStorage.setItem(seenKey, '1')
  window.history.replaceState({}, '', '/?intro=1')
  renderEntry()
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(enter())
  act(() => vi.advanceTimersByTime(5000))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('honors reduced motion even on the explicit replay URL', () => {
  window.history.replaceState({}, '', '/?intro=1')
  motionChange(true)
  renderEntry()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('fails open when session storage cannot be read', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked storage') })
  renderEntry()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Workspace' })).toBeTruthy()
  expect(vi.getTimerCount()).toBe(0)
})

it('still dismisses when session storage cannot be written', () => {
  renderEntry()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota') })
  fireEvent.click(enter())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Workspace' })).toBeTruthy()
})

it('preserves workspace state and auth effects across dismissal and rerender under StrictMode', () => {
  const mounted = vi.fn()
  const unmounted = vi.fn()
  const tree = <StrictMode><CinematicEntrance><Workspace mounted={mounted} unmounted={unmounted} /></CinematicEntrance></StrictMode>
  const view = render(tree)
  const mountBaseline = mounted.mock.calls.length
  const cleanupBaseline = unmounted.mock.calls.length
  const source = screen.getByLabelText('Source')
  fireEvent.change(source, { target: { value: 'unsaved source' } })
  fireEvent.click(enter())
  view.rerender(tree)
  expect(screen.getByLabelText('Source')).toBe(source)
  expect((source as HTMLInputElement).value).toBe('unsaved source')
  expect(mounted).toHaveBeenCalledTimes(mountBaseline)
  expect(unmounted).toHaveBeenCalledTimes(cleanupBaseline)
  expect(fetch).not.toHaveBeenCalled()
  expect(Worker).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(5000))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('restores previous overflow and cancels timers on unmount without storage or focus side effects', () => {
  document.body.style.overflow = 'scroll'
  const view = render(<StrictMode><CinematicEntrance><Workspace /></CinematicEntrance></StrictMode>)
  expect(vi.getTimerCount()).toBe(1)
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  view.unmount()
  expect(document.body.style.overflow).toBe('scroll')
  expect(listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  act(() => vi.advanceTimersByTime(5000))
  expect(storage).not.toHaveBeenCalled()
  expect(focus).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(Worker).not.toHaveBeenCalled()
})