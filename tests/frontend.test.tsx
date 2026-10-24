import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { ErrorBoundary } from '../src/ErrorBoundary'
import { initialPrimePrompt } from '../src/primeWorkflow'
import { PROGRESS_KEY, createEmptyProgress, recordChallengeCompletion } from '../src/progress'
import { MAX_FIXTURE_MAGNITUDE, calculateRequirementCoverage } from '../src/coverage'
import { LearningApiError, requestLearningPlan, requestProgressiveHints, requestMentorReply } from '../src/learningApi'

const planPayload = {
  mode: 'deterministic-demo', results_are_suggestions: true, code_execution: 'disabled',
  title: 'Installed plan', requirements: ['Return True when no divisor is found (including 2)', 'Reject numbers below 2'],
  test_cases: [{ input: '2', expected: 'True', category: 'boundary' }, { input: '9', expected: 'False', category: 'ordinary' }],
  hints: ['Plan clue one', 'Plan clue two'],
}
const hintsPayload = { mode: 'deterministic-demo', code_execution: 'disabled', reveal_policy: 'one-at-a-time', hints: ['Fetched clue one', 'Fetched clue two'] }
const mentorPayload = { mode: 'deterministic-demo', code_execution: 'disabled', ai_unavailable: false, message: 'Delayed mentor answer', guiding_question: 'Why?', hints: ['Mentor clue'] }
const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 })
const buildPlan = () => fireEvent.click(screen.getByRole('button', { name: /Build requirements/ }))
const revealHint = () => fireEvent.click(screen.getByRole('button', { name: /Reveal first hint/ }))
const askMentor = () => {
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Why does this work?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask mentor' }))
}
const stored = () => JSON.parse(localStorage.getItem(PROGRESS_KEY)!)
async function flush() { await act(async () => { await Promise.resolve() }) }
function deferred() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}
function mount() { return render(<StrictMode><App /></StrictMode>) }

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(async () => json(planPayload)))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('a delayed plan preserves hints and rewards earned during the request, including persisted StrictMode state', async () => {
  const delayed = deferred()
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/plan') ? delayed.promise : Promise.resolve(json(hintsPayload))))
  mount()
  buildPlan()
  revealHint()
  await flush()
  fireEvent.change(screen.getByLabelText('Your explanation'), { target: { value: 'A zero remainder means a divisor is a factor, so return False because the number is not prime.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
  expect(stored().hintsUsed).toBe(1)
  expect(stored().unlockedAchievements).toContain('clear-explanation')
  await act(async () => { delayed.resolve(json(planPayload)) })
  expect(stored().hintsUsed).toBe(1)
  expect(stored().xp).toBe(10)
  expect(stored().coverageResults).toHaveLength(1)
})

describe.each(['plan', 'hints', 'mentor'] as const)('%s request invalidation', (kind) => {
  function begin() {
    if (kind === 'plan') buildPlan()
    else if (kind === 'hints') revealHint()
    else askMentor()
  }
  const payload = () => kind === 'plan' ? planPayload : kind === 'hints' ? hintsPayload : mentorPayload

  it.each(['Reset challenge', 'Reset progress'])('does not repopulate after %s, even when fetch ignores abort', async (reset) => {
    const delayed = deferred()
    const fetcher = vi.fn(() => delayed.promise)
    vi.stubGlobal('fetch', fetcher)
    mount()
    begin()
    fireEvent.click(screen.getByRole('button', { name: reset }))
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => { delayed.resolve(json(payload())) })
    expect(stored().coverageResults).toHaveLength(0)
    expect(stored().hintsUsed).toBe(0)
    expect(screen.queryByText('Fetched clue one')).toBeNull()
    expect(screen.queryByText('Delayed mentor answer')).toBeNull()
    expect(screen.queryByText(/Showing the local demo plan|Revealing the hints already|Showing deterministic local/)).toBeNull()
  })

  it('discards stale completions after editing the draft prompt', async () => {
    const delayed = deferred()
    vi.stubGlobal('fetch', vi.fn(() => delayed.promise))
    mount()
    begin()
    fireEvent.change(screen.getByLabelText('Programming prompt'), { target: { value: 'Check even numbers' } })
    await act(async () => { delayed.resolve(json(payload())) })
    expect(stored().coverageResults).toHaveLength(0)
    expect(stored().hintsUsed).toBe(0)
    expect(screen.queryByText('Delayed mentor answer')).toBeNull()
  })

  it('aborts on account transition and keeps the next account store isolated', async () => {
    const delayed = deferred()
    vi.stubGlobal('fetch', vi.fn(() => delayed.promise))
    const firstStore = { load: createEmptyProgress, save: vi.fn(() => true) }
    const secondStore = { load: createEmptyProgress, save: vi.fn(() => true) }
    const view = render(<App accountKey="first" progressStore={firstStore} />)
    begin()
    view.rerender(<App accountKey="second" progressStore={secondStore} />)
    await act(async () => { delayed.resolve(json(payload())) })
    const lastSave = secondStore.save.mock.calls.at(-1)![0]
    expect(lastSave).toEqual(createEmptyProgress())
    expect(screen.queryByText('Delayed mentor answer')).toBeNull()
  })
})

it('reviews fixed prime checks with their own labels when provider requirements are reordered or unfamiliar', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...planPayload, requirements: ['Provider-specific constraint', ...planPayload.requirements] })))
  mount()
  buildPlan()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Review my code' }))
  const checks = document.querySelector('.review-checks')!
  const failed = checks.querySelector('.review-check-fail')!
  expect(failed.textContent).toContain('Inside the divisible branch, return False')
  expect(failed.textContent).not.toContain('Return True when no divisor is found')
  expect(checks.querySelectorAll('.review-check-pass')[2].textContent).toContain('Return True when no divisor is found')
  expect(checks.querySelectorAll('.review-check')).toHaveLength(4)
  expect(checks.textContent).not.toContain('Provider-specific constraint')
  expect(screen.getByRole('status', { name: 'Code review feedback' }).textContent).toContain('3 of 4')
})

it('announces explanation feedback from a persistent live region', () => {
  mount()
  const region = screen.getByRole('status', { name: 'Explanation feedback' })
  fireEvent.change(screen.getByLabelText('Your explanation'), { target: { value: 'I am thinking about a divisor.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get feedback' }))
  expect(region.textContent).not.toBe('Show your thinking.')
})

it('updates persistent hint and mentor live regions with request results', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('/hints') ? hintsPayload : mentorPayload)))
  mount()
  const hintRegion = screen.getByRole('status', { name: 'Progressive hints' })
  const mentorRegion = screen.getByRole('status', { name: 'Mentor response' })
  revealHint()
  expect(hintRegion.getAttribute('aria-busy')).toBe('true')
  await flush()
  expect(hintRegion.textContent).toContain('Fetched clue one')
  expect(hintRegion.getAttribute('aria-busy')).toBe('false')
  askMentor()
  expect(mentorRegion.getAttribute('aria-busy')).toBe('true')
  await flush()
  expect(mentorRegion.textContent).toContain('Delayed mentor answer')
  expect(mentorRegion.getAttribute('aria-busy')).toBe('false')
})

it('hints and mentor use the installed prompt, not a different unsubmitted draft', async () => {
  const fetcher = vi.fn(async (url: string) => json(url.endsWith('/hints') ? hintsPayload : mentorPayload))
  vi.stubGlobal('fetch', fetcher)
  mount()
  fireEvent.change(screen.getByLabelText('Programming prompt'), { target: { value: 'Check even numbers' } })
  revealHint()
  await flush()
  askMentor()
  await flush()
  expect(fetcher.mock.calls).toHaveLength(2)
  for (const call of fetcher.mock.calls) expect(JSON.parse(call[1].body).prompt).toBe(initialPrimePrompt)
  expect(screen.getByText(`Active plan prompt: ${initialPrimePrompt}`)).toBeTruthy()
})

it('uses the new installed prompt after successfully building a new plan', async () => {
  const fetcher = vi.fn(async (url: string) => json(url.endsWith('/plan') ? planPayload : url.endsWith('/hints') ? hintsPayload : mentorPayload))
  vi.stubGlobal('fetch', fetcher)
  mount()
  fireEvent.change(screen.getByLabelText('Programming prompt'), { target: { value: 'Check even numbers' } })
  buildPlan()
  await flush()
  revealHint()
  await flush()
  askMentor()
  await flush()
  for (const call of fetcher.mock.calls.slice(1)) expect(JSON.parse(call[1].body).prompt).toBe('Check even numbers')
})

it('keeps fallback hint provenance bound to the actual hints and resets it with the plan', async () => {
  let planCalls = 0
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/plan')) return json({ ...planPayload, mode: planCalls++ === 0 ? 'openai' : 'deterministic-demo' })
    throw new Error('offline')
  })
  vi.stubGlobal('fetch', fetcher)
  mount()
  buildPlan()
  await flush()
  revealHint()
  await flush()
  const hintPanel = screen.getByText('Need a hint?').closest('section')!
  expect(within(hintPanel).getByText(/AI-generated clues/)).toBeTruthy()
  expect(within(hintPanel).getByText('Plan clue one')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Reveal next hint/ }))
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(within(hintPanel).getByText('Plan clue two')).toBeTruthy()
  buildPlan()
  await flush()
  expect(within(hintPanel).getByText(/Demo-generated clues/)).toBeTruthy()
  expect(within(hintPanel).queryByText('Plan clue one')).toBeNull()
  revealHint()
  await flush()
  expect(within(hintPanel).getByText('Plan clue one')).toBeTruthy()
  expect(within(hintPanel).getByText(/Demo-generated clues/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Reset challenge' }))
  expect(within(hintPanel).getByText(/Demo-generated clues/)).toBeTruthy()
})

it.each(['hints', 'mentor'])('a new plan invalidates pending %s and does not install its old answer', async (kind) => {
  const delayed = deferred()
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/plan') ? Promise.resolve(json(planPayload)) : delayed.promise))
  mount()
  if (kind === 'hints') revealHint()
  else askMentor()
  buildPlan()
  await flush()
  await act(async () => { delayed.resolve(json(kind === 'hints' ? hintsPayload : mentorPayload)) })
  expect(screen.queryByText('Fetched clue one')).toBeNull()
  expect(screen.queryByText('Delayed mentor answer')).toBeNull()
  expect(stored().hintsUsed).toBe(0)
  expect(stored().coverageResults).toHaveLength(1)
})

it('restored browser progress cannot claim verified test achievements while execution is disabled', () => {
  const forged = recordChallengeCompletion(createEmptyProgress(), { challengeId: 'old', kind: 'learning', completedAt: new Date().toISOString(), score: 100, hintsUsed: 0, verifiedTestsPassed: true })
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(forged))
  mount()
  expect(stored().unlockedAchievements).not.toContain('passed-tests')
  expect(stored().history[0].verifiedTestsPassed).toBe(false)
  expect(screen.getByText('Tested and true').closest('li')!.textContent).toContain('LOCKED')
})

it('moves keyboard focus to shortcut destinations', () => {
  const scroll = vi.fn()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  mount()
  const target = document.getElementById('mentor')!
  target.scrollIntoView = scroll
  fireEvent.click(screen.getByRole('button', { name: /Code Mentor/ }))
  expect(document.activeElement).toBe(target)
  expect(scroll).toHaveBeenCalled()
})

it('contains render failures in the application boundary', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const suppressExpectedError = (event: ErrorEvent) => { event.preventDefault() }
  window.addEventListener('error', suppressExpectedError)
  function Broken() { throw new Error('render failure'); return null }
  render(<ErrorBoundary><Broken /></ErrorBoundary>)
  window.removeEventListener('error', suppressExpectedError)
  expect(screen.getByRole('alert').textContent).toContain('could not display this page')
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy()
})

const mentorInput = { prompt: 'prime', requirements: [], test_results: [], challenge: '', learner_text: '', question: 'Why?', use_ai: false }
const requesters = [
  { name: 'plan', request: (fetcher: typeof fetch, options: { signal?: AbortSignal; timeoutMs?: number }) => requestLearningPlan('prime', fetcher, false, options) },
  { name: 'hints', request: (fetcher: typeof fetch, options: { signal?: AbortSignal; timeoutMs?: number }) => requestProgressiveHints('prime', [], fetcher, false, options) },
  { name: 'mentor', request: (fetcher: typeof fetch, options: { signal?: AbortSignal; timeoutMs?: number }) => requestMentorReply(mentorInput, fetcher, options) },
]

describe.each(requesters)('$name cancellation and deadlines', ({ request }) => {
  it.each(['fetch', 'json'])('times out a stalled %s even if it ignores the abort signal', async (phase) => {
    vi.useFakeTimers()
    const fetcher = vi.fn(() => phase === 'fetch' ? new Promise<Response>(() => {}) : Promise.resolve({ ok: true, json: () => new Promise(() => {}) } as Response))
    const pending = request(fetcher as typeof fetch, { timeoutMs: 50 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(51)
    await assertion
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['fetch', 'json'])('classifies intentional cancellation while %s is stalled', async (phase) => {
    const controller = new AbortController()
    const fetcher = vi.fn(() => phase === 'fetch' ? new Promise<Response>(() => {}) : Promise.resolve({ ok: true, json: () => new Promise(() => {}) } as Response))
    const pending = request(fetcher as typeof fetch, { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted', name: 'LearningApiError' })
  })

  it('does not start fetch for an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn()
    await expect(request(fetcher, { signal: controller.signal })).rejects.toBeInstanceOf(LearningApiError)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

it('supports the maximum fixture magnitude and marks larger safe integers untested within a bounded budget', () => {
  const cases = [
    { input: `is_prime(${MAX_FIXTURE_MAGNITUDE})`, expected: 'false' },
    { input: 'is_prime(999999937)', expected: 'true' },
    { input: 'is_prime(-1000000000)', expected: 'false' },
  ]
  const started = performance.now()
  const report = calculateRequirementCoverage('prime', ['Return False when a divisor is found', 'Return True when no divisor is found', 'Reject numbers below 2'], cases)
  expect(report.passed).toBe(3)
  const unsupported = calculateRequirementCoverage('prime', Array(12).fill('Return True when no divisor is found'), Array(12).fill({ input: 'is_prime(9007199254740881)', expected: 'true' }))
  expect(unsupported.untested).toBe(12)
  expect(unsupported.requirements[0].cases[0].observed).toBeNull()
  expect(performance.now() - started).toBeLessThan(1000)
})