import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import { AIConnectionStatus } from '../src/AIConnectionStatus'
import { PROGRESS_KEY } from '../src/progress'

const demo = {
  mode: 'deterministic-demo', results_are_suggestions: true, code_execution: 'disabled',
  title: 'Demo task', requirements: ['Handle ordinary input', 'Handle a boundary input'],
  test_cases: [
    { input: 'ordinary input', expected: 'Confirm the expected output', category: 'ordinary' },
    { input: 'boundary input', expected: 'Define the expected output', category: 'boundary' },
  ], hints: ['Consider the boundary.'],
}
const ai = { ...demo, mode: 'openai', title: 'AI Armstrong suggestions', test_cases: [
  { input: 'is_armstrong(153)', expected: 'True', category: 'ordinary' },
  { input: 'is_armstrong(154)', expected: 'False', category: 'ordinary' },
] }
const source = 'def is_armstrong(number):\n    return sum(int(digit) ** len(str(number)) for digit in str(number)) == number\n'
const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 })
const mount = () => render(<StrictMode><App /></StrictMode>)
const prompt = (value: string) => fireEvent.change(screen.getByLabelText('Programming prompt'), { target: { value } })
const edit = (value = source) => fireEvent.change(screen.getByLabelText('Python code editor'), { target: { value } })
const optIn = () => fireEvent.click(screen.getByLabelText('Allow configured AI for this request (may incur cost)'))
const share = () => fireEvent.click(screen.getByLabelText('Include editor code in AI test suggestions'))
const generate = () => fireEvent.click(screen.getByRole('button', { name: 'Generate AI test cases' }))
const show = () => fireEvent.click(screen.getByRole('button', { name: 'Show test cases' }))
const build = () => fireEvent.click(screen.getByRole('button', { name: /Build requirements/ }))
const feedback = () => screen.getByRole('status', { name: 'Test case feedback' })
const cases = () => screen.getByRole('heading', { name: /Suggested test cases|Prime test suggestions/ }).closest('section')!
async function flush() { await act(async () => { await Promise.resolve() }) }
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}
function fetchMock(payload: unknown = demo) {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => json(payload))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const body = (call: [RequestInfo | URL, RequestInit?]) => JSON.parse(String(call[1]?.body))

beforeEach(() => { localStorage.clear(); fetchMock() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shows draft Armstrong cases through the test endpoint, upgrades demo placeholders, and preserves pasted code exactly', async () => {
  const fetcher = fetchMock()
  mount()
  const region = feedback()
  prompt('Write an Armstrong number checker')
  edit()
  show()
  expect(screen.getByRole('button', { name: 'Preparing test cases…' }).hasAttribute('disabled')).toBe(true)
  await flush()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe('/api/learning/test-cases')
  expect(body(fetcher.mock.calls[0])).toEqual({ prompt: 'Write an Armstrong number checker', use_ai: false })
  expect((screen.getByLabelText('Python code editor') as HTMLTextAreaElement).value).toBe(source)
  expect(within(cases()).getByText('is_armstrong(153)')).toBeTruthy()
  expect(within(cases()).getByText('is_armstrong(9474)')).toBeTruthy()
  expect(region).toBe(feedback())
  expect(region.textContent).toContain('Showing 6 suggested cases')
  expect(region.textContent).toContain('not executed')
  expect(document.activeElement).toBe(cases())
})

it('keeps initial prime review request-free and gives fresh feedback and focus even when cases are already shown', () => {
  const fetcher = fetchMock()
  mount()
  const review = screen.getByRole('button', { name: 'Review my code' })
  fireEvent.click(review)
  const oldAnnouncement = feedback().firstChild
  review.focus()
  fireEvent.click(review)
  expect(fetcher).not.toHaveBeenCalled()
  expect(feedback().firstChild).not.toBe(oldAnnouncement)
  expect(feedback().textContent).toContain('Showing 7 suggested cases')
  expect(document.activeElement).toBe(cases())
  expect(screen.getByRole('status', { name: 'Code review feedback' }).textContent).toContain('3 of 4')
})

it.each([false, true])('uses explicit AI generation with source consent=%s and labels unexecuted case outputs', async (consent) => {
  const fetcher = fetchMock({ ...ai, source_used_for_suggestions: consent })
  mount()
  edit()
  optIn()
  if (consent) share()
  generate()
  await flush()
  const call = fetcher.mock.calls[0]
  expect(call[0]).toBe('/api/learning/test-cases')
  expect(body(call).use_ai).toBe(true)
  expect(body(call).source).toBe(consent ? source : undefined)
  expect(within(cases()).getByText('is_armstrong(154)')).toBeTruthy()
  expect(within(cases()).getByText('False')).toBeTruthy()
  expect(within(cases()).getAllByText('AI SUGGESTION')).toHaveLength(2)
  expect(screen.queryByText('Editor code shared for suggestions; not executed.') !== null).toBe(consent)
  expect(localStorage.getItem(PROGRESS_KEY)).not.toContain(source)
  expect(localStorage.getItem(PROGRESS_KEY)).not.toContain('shareSource')
})

it.each(['Reset challenge', 'source edit', 'source toggle', 'AI off', 'prompt edit', 'account transition', 'unmount'])('discards a pending source-based result after %s even if fetch ignores abort', async (change) => {
  const delayed = deferred()
  const fetcher = vi.fn((_url: RequestInfo | URL, _options?: RequestInit) => delayed.promise)
  vi.stubGlobal('fetch', fetcher)
  const view = mount()
  optIn(); share(); edit(); generate()
  if (change === 'source edit') edit('print("new source")')
  else if (change === 'source toggle') share()
  else if (change === 'AI off') optIn()
  else if (change === 'prompt edit') prompt('Check Armstrong numbers')
  else if (change === 'account transition') view.rerender(<App accountKey="new-account" />)
  else if (change === 'unmount') view.unmount()
  else fireEvent.click(screen.getByRole('button', { name: change }))
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  await act(async () => { delayed.resolve(json({ ...ai, source_used_for_suggestions: true })) })
  expect(screen.queryByText('AI Armstrong suggestions')).toBeNull()
  expect(screen.queryByText('Editor code shared for suggestions; not executed.')).toBeNull()
  if (change !== 'unmount') expect(feedback().textContent).toBe('')
})

it('clears source choice on AI off and reset, never leaking source on subsequent requests', async () => {
  const fetcher = fetchMock(ai)
  mount()
  expect((screen.getByLabelText('Include editor code in AI test suggestions') as HTMLInputElement).disabled).toBe(true)
  optIn(); share(); edit(); optIn(); optIn()
  expect((screen.getByLabelText('Include editor code in AI test suggestions') as HTMLInputElement).checked).toBe(false)
  generate(); await flush()
  expect(body(fetcher.mock.calls[0]).source).toBeUndefined()
  share()
  fireEvent.click(screen.getByRole('button', { name: 'Reset challenge' }))
  expect(feedback().textContent).toBe('')
  expect((screen.getByLabelText('Include editor code in AI test suggestions') as HTMLInputElement).checked).toBe(false)
  optIn(); generate(); await flush()
  expect(body(fetcher.mock.calls[1]).source).toBeUndefined()
})

it('does not send editor source on build, hints, or mentor even with both consent flags enabled', async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL, _options?: RequestInit) => json(String(url).endsWith('/hints')
    ? { mode: 'openai', code_execution: 'disabled', reveal_policy: 'one-at-a-time', hints: ['A clue'] }
    : String(url).endsWith('/mentor')
      ? { mode: 'openai', ai_unavailable: false, code_execution: 'disabled', message: 'Consider a divisor.', guiding_question: 'Why?', hints: ['A clue'] }
      : ai))
  vi.stubGlobal('fetch', fetcher)
  mount()
  optIn(); share(); edit(); build(); await flush()
  fireEvent.click(screen.getByRole('button', { name: /Reveal first hint/ })); await flush()
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Why?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask mentor' })); await flush()
  expect(fetcher).toHaveBeenCalledTimes(3)
  for (const call of fetcher.mock.calls) {
    expect(body(call).source).toBeUndefined()
    expect(String(call[1]?.body)).not.toContain('def is_armstrong')
  }
})

it('caps editor input and blocks oversized shared bodies locally without truncating pasted code', async () => {
  const fetcher = fetchMock()
  mount()
  expect((screen.getByLabelText('Python code editor') as HTMLTextAreaElement).maxLength).toBe(20000)
  optIn(); share(); edit('x'.repeat(20001)); generate(); await flush()
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.getByText(/Editor code must contain at most 20000 characters/)).toBeTruthy()
  expect((screen.getByLabelText('Python code editor') as HTMLTextAreaElement).value).toHaveLength(20001)
  edit('x'.repeat(20000)); generate(); await flush()
  expect(body(fetcher.mock.calls[0]).source).toHaveLength(20000)
})

it('honestly reports unknown demo placeholders and repeats Show feedback without another request', async () => {
  const fetcher = fetchMock()
  mount()
  prompt('Organize my moon rocks'); show(); await flush()
  expect(feedback().textContent).toContain('needs concrete inputs and outputs')
  const oldAnnouncement = feedback().firstChild
  show()
  expect(feedback().firstChild).not.toBe(oldAnnouncement)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('upgrades an installed generic plan when the local rules recognize Armstrong', async () => {
  fetchMock({ ...demo, mode: 'openai' })
  mount()
  prompt('Check Armstrong numbers'); build(); await flush()
  const fetcher = fetchMock()
  show(); await flush()
  expect(fetcher.mock.calls[0][0]).toBe('/api/learning/test-cases')
  expect(within(cases()).getByText('is_armstrong(9474)')).toBeTruthy()
})

it('disables test generation for an empty draft and accurately describes unavailable AI', async () => {
  fetchMock({ ...demo, ai_unavailable: true })
  mount()
  prompt(' ')
  expect(screen.getByRole('button', { name: 'Show test cases' }).hasAttribute('disabled')).toBe(true)
  prompt('Check Armstrong numbers'); optIn(); generate(); await flush()
  expect(screen.getByText(/server may have AI disabled or no backend API key/)).toBeTruthy()
})

it.each([
  { configured: true, enabled: true, expected: 'OpenAI ready: gpt-test' },
  { configured: true, enabled: false, expected: 'server must enable the paid AI flag' },
  { configured: false, enabled: true, expected: 'needs a backend API key' },
  { configured: false, enabled: false, expected: 'needs a backend API key' },
])('checks availability only on explicit GET: $configured/$enabled', async ({ configured, enabled, expected }) => {
  const fetcher = fetchMock({ provider: 'openai', configured, enabled, available: configured && enabled, model: 'gpt-test', code_execution: 'disabled' })
  mount()
  expect(fetcher).not.toHaveBeenCalled()
  const region = screen.getByRole('status', { name: 'OpenAI availability' })
  fireEvent.click(screen.getByRole('button', { name: 'Check OpenAI availability' }))
  await flush()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe('/api/ai/status')
  expect(fetcher.mock.calls[0][1]?.method).toBe('GET')
  expect(fetcher.mock.calls[0][1]?.body).toBeUndefined()
  expect(region.textContent).toContain(expected)
  expect((screen.getByLabelText('Allow configured AI for this request (may incur cost)') as HTMLInputElement).checked).toBe(false)
  expect(screen.queryByLabelText(/API key/)).toBeNull()
})

it('aborts an availability check on unmount and reports backend failures without model calls', async () => {
  const delayed = deferred()
  const fetcher = vi.fn((_url: RequestInfo | URL, _options?: RequestInit) => delayed.promise)
  vi.stubGlobal('fetch', fetcher)
  const view = render(<AIConnectionStatus />)
  fireEvent.click(screen.getByRole('button', { name: 'Check OpenAI availability' }))
  view.unmount()
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  await act(async () => { delayed.resolve(json({})) })
  fetchMock({})
  render(<AIConnectionStatus />)
  fireEvent.click(screen.getByRole('button', { name: 'Check OpenAI availability' })); await flush()
  expect(screen.getByRole('status', { name: 'OpenAI availability' }).textContent).toContain('backend is running')
})