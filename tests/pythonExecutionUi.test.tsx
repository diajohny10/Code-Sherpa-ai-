import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PythonExecutionPanel } from '../src/PythonExecutionPanel'
import App from '../src/App'
import { runPython } from '../src/execution/client'
import { createEmptyProgress } from '../src/progress'
import { primeSampleCases, starterPrimeCode } from '../src/primeWorkflow'

vi.mock('../src/execution/client', () => ({ runPython: vi.fn() }))

type Request = Parameters<typeof runPython>[0]
type Report = Awaited<ReturnType<typeof runPython>>
type Result = Report['results'][number]
const engine = vi.mocked(runPython)
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }))
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
const executionStatus = () => screen.getByRole('status', { name: 'Python execution status' }).textContent
const assertCase = (index = 1) => fireEvent.click(screen.getByLabelText(`Assert expected value for case ${index}`))
const functionMode = () => change('Execution mode', 'function')
const result = (overrides: Partial<Result> = {}): Result => ({
  id: 'run', status: 'completed', stdout: '', stderr: '', exitCode: 0, durationMs: 2, ...overrides,
})
function report(request: Request, results?: Result[]): Report {
  const observations = results ?? (request.operation === 'syntax' ? [result({ id: 'syntax' })] : request.cases.map((item) => result({
    id: item.id, status: Object.prototype.hasOwnProperty.call(item, 'expected') ? 'passed' : 'completed',
    ...(request.mode === 'script' ? { stdout: typeof item.expected === 'string' ? item.expected : 'hello\n' } : { actual: item.expected ?? null }),
  })))
  const passed = observations.filter((item) => item.status === 'passed').length
  const failed = observations.filter((item) => item.status !== 'passed' && item.status !== 'completed').length
  return {
    engine: 'cpython-wasi', runtimeVersion: '3.14.9', operation: request.operation, mode: request.mode,
    sourceHash: request.source, suiteHash: JSON.stringify([request.mode, request.functionName, request.cases]),
    results: observations, passed, failed, allPassed: passed === observations.length, durationMs: 2,
  }
}
function deferred() {
  let resolve!: (value: Report) => void
  const promise = new Promise<Report>((done) => { resolve = done })
  return { promise, resolve }
}
async function started() { await waitFor(() => expect(engine).toHaveBeenCalled()) }
async function finished() { await waitFor(() => expect(screen.getByRole('status', { name: 'Python execution status' }).getAttribute('aria-busy')).toBe('false')) }
function setFunctionCase(input = '[9]', expected = 'false') {
  functionMode()
  change('Case 1 JSON arguments', input)
  change('Case 1 expected JSON value', expected)
  assertCase()
}

beforeEach(() => {
  engine.mockReset()
  engine.mockImplementation(async (request) => report(request))
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request') }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('starts in script mode and runs the unchanged source and stdin without an assertion or pass label', async () => {
  const source = 'number = int(input())\nprint(number ** 3)'
  render(<PythonExecutionPanel source={source} />)
  expect((screen.getByLabelText('Execution mode') as HTMLSelectElement).value).toBe('script')
  expect(screen.getByLabelText('Program input (stdin)').getAttribute('maxlength')).toBe('8192')
  change('Program input (stdin)', '153\n')
  click('Run Python')
  await started()
  await finished()
  expect(engine.mock.calls[0][0]).toEqual({ source, operation: 'run', mode: 'script', cases: [{ id: 'run', stdin: '153\n' }] })
  expect(screen.getByRole('heading', { name: 'run: completed' })).toBeTruthy()
  expect(executionStatus()).toContain('No expected-value assertion')
  expect(screen.queryByText(/\d+ passed/)).toBeNull()
  expect(screen.queryByText(/previously failing/)).toBeNull()
})

it('checks syntax only and displays a syntax error type, line and traceback as text', async () => {
  engine.mockImplementation(async (request) => report(request, [result({
    id: 'syntax', status: 'syntax_error', exitCode: 1,
    error: { type: 'SyntaxError', message: 'expected a colon', line: 3 }, stderr: 'File "solution.py", line 3\nSyntaxError: expected a colon',
  })]))
  render(<PythonExecutionPanel source={'print("side effect")\nif True'} />)
  functionMode()
  change('Run JSON arguments', 'not json')
  click('Check syntax')
  await started()
  await finished()
  expect(engine.mock.calls[0][0]).toMatchObject({ operation: 'syntax', mode: 'script', cases: [{ id: 'syntax' }] })
  expect(screen.getByText('SyntaxError at line 3: expected a colon')).toBeTruthy()
  expect(screen.getByText(/File "solution.py", line 3/)).toBeTruthy()
  expect(executionStatus()).not.toContain('Syntax check completed;')
})

it('renders runtime exceptions, exit codes, stdout and stderr without HTML interpretation', async () => {
  const payload = '<img src=x onerror="alert(1)"><script>throw 1</script>'
  engine.mockImplementation(async (request) => report(request, [result({
    status: 'runtime_error', exitCode: 1, stdout: payload, stderr: 'Traceback: ZeroDivisionError',
    error: { type: 'ZeroDivisionError', message: 'division by zero', line: 2 },
  })]))
  const view = render(<PythonExecutionPanel source="1 / 0" />)
  click('Run Python')
  await started()
  await finished()
  expect(screen.getByText('ZeroDivisionError at line 2: division by zero')).toBeTruthy()
  expect(screen.getByText('Traceback: ZeroDivisionError')).toBeTruthy()
  expect(screen.getByText(payload)).toBeTruthy()
  expect(view.container.querySelector('img, script')).toBeNull()
  expect(screen.getByText(/Exit code: 1/)).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'run: runtime error' })).toBeTruthy()
})

it('shows an actual stdout mismatch as failed, alongside the expected output', async () => {
  engine.mockImplementation(async (request) => report(request, [result({ id: request.cases[0].id, status: 'failed', stdout: 'False\n' })]))
  render(<PythonExecutionPanel source={'print(False)'} />)
  change('Case 1 stdin', '153')
  change('Case 1 expected output', 'True')
  assertCase()
  click('Run tests')
  await started()
  await finished()
  expect(executionStatus()).toContain('0 passed, 1 failed')
  expect(screen.getByRole('heading', { name: 'case-1: failed' })).toBeTruthy()
  expect(screen.getByText('"False\\n"')).toBeTruthy()
  expect(screen.getByText('"True"')).toBeTruthy()
})

it('treats explicit empty stdout and function null expectations as real assertions', async () => {
  render(<PythonExecutionPanel source="pass" />)
  click('Run tests')
  expect(screen.getByRole('alert').textContent).toContain('enable an expected-value assertion')
  expect(engine).not.toHaveBeenCalled()
  assertCase()
  click('Run tests')
  await started()
  await finished()
  expect(engine.mock.calls[0][0].cases[0].expected).toBe('')
  setFunctionCase('[]', 'null')
  assertCase()
  click('Run tests')
  await waitFor(() => expect(engine).toHaveBeenCalledTimes(2))
  await finished()
  expect(engine.mock.calls[1][0].cases[0]).toMatchObject({ args: [], expected: null })
})

it('runs function JSON arguments without an expected value', async () => {
  render(<PythonExecutionPanel source="def identity(value): return value" />)
  functionMode()
  change('Function name', 'identity')
  change('Run JSON arguments', '[null, true, {"key": [2]}]')
  click('Run Python')
  await started()
  await finished()
  expect(engine.mock.calls[0][0]).toMatchObject({ mode: 'function', functionName: 'identity', cases: [{ id: 'run', args: [null, true, { key: [2] }] }] })
  expect(Object.prototype.hasOwnProperty.call(engine.mock.calls[0][0].cases[0], 'expected')).toBe(false)
  expect(screen.getByRole('heading', { name: 'run: completed' })).toBeTruthy()
})

describe('input validation and case bounds', () => {
  it('rejects unsafe JSON integers before starting the engine', () => {
    render(<PythonExecutionPanel source="pass" />)
    functionMode()
    change('Run JSON arguments', '[9007199254740992]')
    click('Run Python')
    expect(screen.getByRole('alert').textContent).toContain('safe integers')
    expect(engine).not.toHaveBeenCalled()
  })

  it('reports oversized source as an input error rather than an engine failure', () => {
    render(<PythonExecutionPanel source={'x'.repeat(20001)} />)
    click('Check syntax')
    expect(screen.getByRole('alert').textContent).toContain('20000')
    expect(screen.getByRole('alert').textContent).not.toContain('runtime download')
    expect(engine).not.toHaveBeenCalled()
  })

  it.each(['[NaN]', '[1e999]', '__import__("os")', '{"not":"an array"}'])('rejects invalid JSON arguments %s without execution', (input) => {
    render(<PythonExecutionPanel source="pass" />)
    functionMode()
    change('Run JSON arguments', input)
    click('Run Python')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(engine).not.toHaveBeenCalled()
  })

  it('validates function names and every case before dispatch, preserving stable row IDs', async () => {
    render(<PythonExecutionPanel source="pass" />)
    setFunctionCase()
    change('Function name', 'object.method')
    click('Run tests')
    expect(screen.getByRole('alert').textContent).toContain('simple Python identifier')
    change('Function name', 'is_prime')
    click('Add case')
    change('Case 2 JSON arguments', '[4]')
    change('Case 2 expected JSON value', 'False')
    assertCase(2)
    click('Run tests')
    expect(screen.getByRole('alert').textContent).toContain('Case 2:')
    expect(engine).not.toHaveBeenCalled()
    change('Case 2 expected JSON value', 'false')
    click('Run tests')
    await started()
    await finished()
    expect(engine.mock.calls[0][0].cases.map((item) => item.id)).toEqual(['case-1', 'case-2'])
    click('Remove case 1')
    click('Run tests')
    await waitFor(() => expect(engine).toHaveBeenCalledTimes(2))
    expect(engine.mock.calls[1][0].cases[0].id).toBe('case-2')
  })

  it('caps the editable suite at ten cases and does not remove the last row', () => {
    render(<PythonExecutionPanel source="pass" />)
    expect((screen.getByRole('button', { name: 'Remove case 1' }) as HTMLButtonElement).disabled).toBe(true)
    for (let count = 1; count < 10; count += 1) click('Add case')
    expect(screen.getAllByRole('group')).toHaveLength(10)
    expect((screen.getByRole('button', { name: 'Add case' }) as HTMLButtonElement).disabled).toBe(true)
    click('Remove case 5')
    expect(screen.getAllByRole('group')).toHaveLength(9)
  })
})

it('compares a failing prime assertion with changed source only on the exact same suite', async () => {
  engine.mockImplementation(async (request) => report(request, [result({
    id: request.cases[0].id, status: request.source === starterPrimeCode ? 'failed' : 'passed', actual: request.source === starterPrimeCode,
  })]))
  const view = render(<PythonExecutionPanel source={starterPrimeCode} />)
  setFunctionCase()
  click('Run tests')
  await started()
  await finished()
  expect(executionStatus()).toContain('0 passed, 1 failed')
  const repaired = starterPrimeCode.replace('return True  # Can you spot the bug?', 'return False')
  view.rerender(<PythonExecutionPanel source={repaired} />)
  expect(screen.queryByLabelText('Python execution results')).toBeNull()
  click('Run tests')
  await waitFor(() => expect(engine).toHaveBeenCalledTimes(2))
  await finished()
  expect(screen.getByText('This revision passes 1 previously failing case for these inputs')).toBeTruthy()
  expect(screen.queryByText(/fully correct|all bugs fixed/i)).toBeNull()
  click('Run tests')
  await waitFor(() => expect(engine).toHaveBeenCalledTimes(3))
  await finished()
  expect(screen.queryByText(/previously failing/)).toBeNull()
})

it.each(['expectation', 'input', 'mode', 'suite hash'])('does not claim a fix after changing the %s', async (kind) => {
  engine.mockImplementation(async (request) => report(request, [result({ id: request.cases[0].id, status: 'failed', actual: true })]))
  const view = render(<PythonExecutionPanel source="before" />)
  setFunctionCase()
  click('Run tests')
  await started()
  await finished()
  view.rerender(<PythonExecutionPanel source="after" />)
  if (kind === 'expectation') change('Case 1 expected JSON value', 'true')
  if (kind === 'input') change('Case 1 JSON arguments', '[4]')
  if (kind === 'mode') change('Execution mode', 'script')
  engine.mockImplementation(async (request) => ({ ...report(request), ...(kind === 'suite hash' ? { suiteHash: 'different-engine-suite' } : {}) }))
  click('Run tests')
  await waitFor(() => expect(engine).toHaveBeenCalledTimes(2))
  await finished()
  expect(screen.queryByText(/previously failing/)).toBeNull()
})

it('uses input-scoped wording when a runtime error no longer occurs after a source revision', async () => {
  engine.mockImplementation(async (request) => report(request, [result({ status: 'runtime_error', error: { type: 'ValueError', message: 'bad value' }, exitCode: 1 })]))
  const view = render(<PythonExecutionPanel source="raise ValueError()" />)
  change('Program input (stdin)', '153')
  click('Run Python')
  await started()
  await finished()
  view.rerender(<PythonExecutionPanel source="print(input())" />)
  engine.mockImplementation(async (request) => report(request))
  click('Run Python')
  await waitFor(() => expect(engine).toHaveBeenCalledTimes(2))
  await finished()
  expect(screen.getByText('Previous error did not occur on this input')).toBeTruthy()
  expect(screen.queryByText(/previously failing|all tests pass/i)).toBeNull()
})

describe('cancellation and stale completion guards', () => {
  it.each(['source', 'prompt', 'plan', 'stdin', 'mode', 'case', 'expected', 'assertion', 'function', 'arguments', 'stop', 'unmount'])('aborts on %s and ignores a completion even if the engine ignores abort', async (kind) => {
    const pending = deferred()
    engine.mockReturnValue(pending.promise)
    const initial = { source: 'print("old")', prompt: 'prime', plan: { id: 'prime' } }
    const view = render(<StrictMode><PythonExecutionPanel {...initial} /></StrictMode>)
    if (kind === 'function' || kind === 'arguments') functionMode()
    click('Run Python')
    await started()
    expect((screen.getByRole('button', { name: 'Run Python' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status', { name: 'Python execution status' }).getAttribute('aria-busy')).toBe('true')
    const [request, options] = engine.mock.calls[0]
    if (kind === 'source') view.rerender(<StrictMode><PythonExecutionPanel {...initial} source="print('reset')" /></StrictMode>)
    if (kind === 'prompt') view.rerender(<StrictMode><PythonExecutionPanel {...initial} prompt="Armstrong" /></StrictMode>)
    if (kind === 'plan') view.rerender(<StrictMode><PythonExecutionPanel {...initial} plan={{ id: 'armstrong' }} /></StrictMode>)
    if (kind === 'stdin') change('Program input (stdin)', '9')
    if (kind === 'mode') functionMode()
    if (kind === 'case') change('Case 1 stdin', '4')
    if (kind === 'expected') change('Case 1 expected output', 'new')
    if (kind === 'assertion') assertCase()
    if (kind === 'function') change('Function name', 'other')
    if (kind === 'arguments') change('Run JSON arguments', '[2]')
    if (kind === 'stop') click('Stop')
    if (kind === 'unmount') view.unmount()
    expect(options?.signal?.aborted).toBe(true)
    await act(async () => { options?.onProgress?.({ completed: 1, total: 1 }); pending.resolve(report(request, [result({ stdout: 'STALE OUTPUT' })])) })
    expect(screen.queryByText('STALE OUTPUT')).toBeNull()
    expect(screen.queryByLabelText('Python execution results')).toBeNull()
    if (kind !== 'unmount') {
      expect(screen.getByRole('status', { name: 'Python execution status' }).getAttribute('aria-busy')).toBe('false')
      expect(executionStatus()).not.toContain('Processed')
      if (kind === 'stop') expect(executionStatus()).toContain('Execution stopped')
    }
  })

  it('does not let an older completion overwrite a newer run', async () => {
    const pending = deferred()
    engine.mockReturnValueOnce(pending.promise)
    render(<PythonExecutionPanel source="print(input())" />)
    click('Run Python')
    await started()
    const older = engine.mock.calls[0][0]
    change('Program input (stdin)', 'current')
    engine.mockImplementation(async (request) => report(request, [result({ stdout: 'CURRENT OUTPUT' })]))
    click('Run Python')
    await waitFor(() => expect(screen.getByText('CURRENT OUTPUT')).toBeTruthy())
    await act(async () => pending.resolve(report(older, [result({ stdout: 'OLD OUTPUT' })])))
    expect(screen.getByText('CURRENT OUTPUT')).toBeTruthy()
    expect(screen.queryByText('OLD OUTPUT')).toBeNull()
  })
})

it('imports only safe matching function calls with JSON arguments and literal boolean expectations', () => {
  const suggestions = [...primeSampleCases.slice(0, 2),
    { input: 'is_prime(__import__("os"))', expected: 'False' },
    { input: 'is_prime(9)', expected: 'Confirm behavior' },
    { input: 'other(2)', expected: 'true' },
    { input: 'is_prime(number)', expected: 'True' },
    { input: 'is_prime(True)', expected: 'False' },
  ]
  render(<PythonExecutionPanel source={starterPrimeCode} suggestedCases={suggestions} />)
  functionMode()
  click('Use suggested cases')
  expect(screen.getByText(/Imported 2 suggested cases; skipped 5/)).toBeTruthy()
  expect((screen.getByLabelText('Case 1 JSON arguments') as HTMLTextAreaElement).value).toBe('[2]')
  expect((screen.getByLabelText('Case 1 expected JSON value') as HTMLTextAreaElement).value).toBe('true')
  expect(engine).not.toHaveBeenCalled()
})

it('skips unknown suggestions in script mode and imports literal numeric stdin without running it', () => {
  render(<PythonExecutionPanel source="print(input())" suggestedCases={[
    { input: 'is_armstrong(153)', expected: 'True' }, { input: '153', expected: 'True' },
    { input: 'sample input', expected: 'Define output' }, { input: '1 + 2', expected: '3' },
  ]} />)
  click('Use suggested cases')
  expect(screen.getByText(/Imported 1 suggested cases; skipped 3/)).toBeTruthy()
  expect((screen.getByLabelText('Case 1 stdin') as HTMLTextAreaElement).value).toBe('153')
  expect(engine).not.toHaveBeenCalled()
})

it.each(['timeout', 'output_limit', 'memory_limit', 'unsupported', 'engine_error', 'cancelled'] as const)('shows %s as an unsuccessful result, never a pass', async (status) => {
  engine.mockImplementation(async (request) => report(request, [result({ id: 'case-1', status, exitCode: null })]))
  render(<PythonExecutionPanel source="while True: pass" />)
  assertCase()
  click('Run tests')
  await started()
  await finished()
  expect(screen.getByRole('heading', { name: `case-1: ${status.replace(/_/g, ' ')}` })).toBeTruthy()
  expect(executionStatus()).toContain('0 passed, 1 failed')
})

it('reports missing worker support or runtime download failures with a retryable error', async () => {
  engine.mockRejectedValue(new Error('Web Worker unavailable / runtime download failed'))
  render(<PythonExecutionPanel source="pass" />)
  click('Run Python')
  await started()
  await finished()
  expect(screen.getByRole('alert').textContent).toContain('Web Worker/WebAssembly support')
  expect(executionStatus()).toContain('no successful result')
  expect(screen.queryByLabelText('Python execution results')).toBeNull()
})

it('does not expose a false failure on AbortError', async () => {
  engine.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
  render(<PythonExecutionPanel source="pass" />)
  click('Run Python')
  await started()
  await finished()
  expect(executionStatus()).toContain('Execution stopped')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('preserves App source and fixture labels, awards no progress, makes no cloud calls and persists no execution data', async () => {
  const progressStore = { load: createEmptyProgress, save: vi.fn(() => true) }
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const view = render(<App accountKey="guest" progressStore={progressStore} />)
  const source = screen.getByLabelText('Python code editor') as HTMLTextAreaElement
  const initial = source.value
  assertCase()
  click('Run tests')
  await started()
  await finished()
  expect(source.value).toBe(initial)
  expect(fetch).not.toHaveBeenCalled()
  expect(storage).not.toHaveBeenCalled()
  for (const call of progressStore.save.mock.calls) expect(call[0]).toEqual(createEmptyProgress())
  const achievements = view.container.querySelector('.achievements-panel')!
  expect(within(achievements as HTMLElement).getByText(/browser self-checks are not server-verified/)).toBeTruthy()
  expect(achievements.querySelectorAll('.achievement-earned')).toHaveLength(0)
  expect(screen.getByText('Reference examples (not your code)')).toBeTruthy()
  expect(screen.getByLabelText('Requirement test coverage score').textContent).toBe('Not tested')
  expect(screen.getByText('Demo-generated expected values \u00b7 not executed')).toBeTruthy()
  view.rerender(<App accountKey="signed-in" progressStore={progressStore} />)
  expect(screen.queryByLabelText('Python execution results')).toBeNull()
  click('Run Python')
  await waitFor(() => expect(engine).toHaveBeenCalledTimes(2))
  await finished()
  expect(fetch).not.toHaveBeenCalled()
})