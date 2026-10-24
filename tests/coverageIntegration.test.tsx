import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import { PythonExecutionPanel } from '../src/PythonExecutionPanel'
import { runPython } from '../src/execution/client'

vi.mock('../src/execution/client', () => ({ runPython: vi.fn() }))
type Request = Parameters<typeof runPython>[0]
type Report = Awaited<ReturnType<typeof runPython>>
const engine = vi.mocked(runPython)
const source = 's = input("Enter a string: ")\nif s == s[::-1]:\n    print("Palindrome")\nelse:\n    print("Not a palindrome")'
const requirements = ['Recognize matching strings', 'Reject nonmatching strings']
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }))
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
const score = () => screen.getByLabelText('Requirement test coverage score').textContent
const callback = () => vi.fn()
function result(request: Request, failed = false): Report {
  const results = request.cases.map(item => ({ id: item.id, status: request.operation === 'test' ? failed ? 'failed' as const : 'passed' as const : 'completed' as const,
    stdout: typeof item.expected === 'string' ? item.expected + '\n' : '', stderr: '', exitCode: 0, durationMs: 1 }))
  return { engine: 'cpython-wasi', runtimeVersion: '3.14.9', operation: request.operation, mode: request.mode,
    sourceHash: request.source, suiteHash: JSON.stringify([request.operation, request.mode, request.functionName, request.cases]), results,
    passed: results.filter(item => item.status === 'passed').length, failed: failed ? results.length : 0,
    allPassed: request.operation === 'test' && !failed, durationMs: 1 }
}
async function finish() {
  await waitFor(() => expect(screen.getByRole('status', { name: 'Python execution status' }).getAttribute('aria-busy')).toBe('false'))
}
function assertedCase() {
  change('Case 1 stdin', 'racecar')
  change('Case 1 expected output', 'Enter a string: Palindrome')
  fireEvent.click(screen.getByLabelText('Assert expected value for case 1'))
}
async function installPalindrome() {
  render(<StrictMode><App /></StrictMode>)
  change('Programming prompt', 'Find whether a string is a palindrome or not')
  change('Python code editor', source)
  click('Show test cases')
  await waitFor(() => expect(screen.getByText(/Active plan prompt: Find whether/)).toBeTruthy())
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  engine.mockReset()
  engine.mockImplementation(async request => result(request, request.source.includes('s !=')))
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"unavailable"}', { status: 502 })))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('emits requirement links only with current completed evidence and never sends them as code inputs', async () => {
  const onEvidenceChange = callback()
  render(<PythonExecutionPanel source={source} requirements={requirements} contextKey="palindrome" onEvidenceChange={onEvidenceChange} />)
  assertedCase()
  click('Link all requirements')
  click('Run tests')
  await waitFor(() => expect(engine).toHaveBeenCalled())
  await finish()
  const evidence = onEvidenceChange.mock.calls.at(-1)![0]
  expect(evidence.requirements).toEqual(requirements)
  expect(evidence.contextKey).toBe('palindrome')
  expect(evidence.caseRequirementIndices).toEqual({ 'case-1': [0, 1] })
  expect(evidence.request.cases).toEqual([{ id: 'case-1', stdin: 'racecar', expected: 'Enter a string: Palindrome' }])
  expect(vi.mocked(fetch)).not.toHaveBeenCalled()
})

it('keeps links across source fixes but resets them when the requirement context changes', async () => {
  const onEvidenceChange = callback()
  const view = render(<PythonExecutionPanel source={source} requirements={requirements} contextKey="first" onEvidenceChange={onEvidenceChange} />)
  assertedCase(); click('Link all requirements'); click('Run tests')
  await waitFor(() => expect(engine).toHaveBeenCalled()); await finish()
  view.rerender(<PythonExecutionPanel source={source + '\n# fix'} requirements={requirements} contextKey="first" onEvidenceChange={onEvidenceChange} />)
  expect(onEvidenceChange.mock.calls.at(-1)![0]).toBeNull()
  expect((screen.getByLabelText('Case 1 requirement 1: Recognize matching strings') as HTMLInputElement).checked).toBe(true)
  view.rerender(<PythonExecutionPanel source={source} requirements={requirements} contextKey="second" onEvidenceChange={onEvidenceChange} />)
  expect((screen.getByLabelText('Case 1 requirement 1: Recognize matching strings') as HTMLInputElement).checked).toBe(false)
})

it('discarded execution cannot install evidence after a source edit', async () => {
  let resolve!: (report: Report) => void
  const pending = new Promise<Report>(done => { resolve = done })
  engine.mockReturnValue(pending)
  const onEvidenceChange = callback()
  const view = render(<PythonExecutionPanel source={source} requirements={requirements} contextKey="task" onEvidenceChange={onEvidenceChange} />)
  assertedCase(); click('Link all requirements'); click('Run tests')
  await waitFor(() => expect(engine).toHaveBeenCalled())
  const request = engine.mock.calls[0][0]
  view.rerender(<PythonExecutionPanel source={source + '\n# edited'} requirements={requirements} contextKey="task" onEvidenceChange={onEvidenceChange} />)
  await act(async () => { resolve(result(request)) })
  expect(onEvidenceChange.mock.calls.at(-1)![0]).toBeNull()
  expect(onEvidenceChange.mock.calls.some(([evidence]) => evidence !== null)).toBe(false)
})

it('syntax checks do not replace stronger unchanged asserted-test evidence', async () => {
  const onEvidenceChange = callback()
  render(<PythonExecutionPanel source={source} requirements={requirements} contextKey="task" onEvidenceChange={onEvidenceChange} />)
  assertedCase(); click('Link all requirements'); click('Run tests')
  await waitFor(() => expect(engine).toHaveBeenCalled()); await finish()
  const evidence = onEvidenceChange.mock.calls.at(-1)![0]
  click('Check syntax')
  await waitFor(() => expect(engine).toHaveBeenCalledTimes(2)); await finish()
  expect(onEvidenceChange.mock.calls.at(-1)![0]).toBe(evidence)
})

it('the palindrome App score updates from real-test callbacks and clears immediately after edits', async () => {
  await installPalindrome()
  expect(score()).toBe('Not tested')
  assertedCase(); click('Link all requirements'); click('Run tests')
  await waitFor(() => expect(score()).toBe('100/100'))
  const panel = screen.getByRole('region', { name: 'Requirement coverage' })
  expect(within(panel).getAllByText('TESTS PASSED')).toHaveLength(4)
  expect((screen.getByLabelText('Python code editor') as HTMLTextAreaElement).value).toBe(source)
  change('Python code editor', source.replace('s ==', 's !='))
  expect(score()).toBe('Not tested')
  click('Run tests')
  await waitFor(() => expect(score()).toBe('0/100'))
  expect(within(panel).getAllByText('FAILING')).toHaveLength(4)
})

it('unlinked passing tests update the test summary without falsely passing requirements', async () => {
  await installPalindrome()
  assertedCase(); click('Run tests')
  await waitFor(() => expect(screen.getByRole('status', { name: 'Requirement coverage status' }).textContent).toContain('1/1 asserted tests passed'))
  expect(score()).toBe('Not tested')
  const panel = screen.getByRole('region', { name: 'Requirement coverage' })
  expect(within(panel.querySelector('.requirement-list') as HTMLElement).getAllByText('UNTESTED')).toHaveLength(4)
  expect(within(panel).getByText(/have no requirement links/)).toBeTruthy()
  click('Link all requirements'); click('Run tests')
  await waitFor(() => expect(score()).toBe('100/100'))
})

it('resetting progress invalidates requirement evidence even if the code is unchanged', async () => {
  await installPalindrome()
  assertedCase(); click('Link all requirements'); click('Run tests')
  await waitFor(() => expect(score()).toBe('100/100'))
  click('Reset progress')
  await waitFor(() => expect(score()).toBe('Not tested'))
  expect((screen.getByLabelText('Python code editor') as HTMLTextAreaElement).value).toBe(source)
})
