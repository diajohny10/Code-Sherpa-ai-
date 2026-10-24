import { useLayoutEffect, useRef, useState } from 'react'
import { Check, FlaskConical, Play, Plus, Square, Trash2 } from 'lucide-react'
import type { JSONValue, PythonTestCase } from './execution/types'
import { validateRequest } from './execution/validation'
import type { BrowserExecutionEvidence } from './executionEvidence'

type Report = Awaited<ReturnType<typeof import('./execution/client')['runPython']>>
type Request = Parameters<typeof import('./execution/client')['runPython']>[0]
type DraftCase = { id: string; input: string; expected: string; asserted: boolean; requirementIndices: number[] }
type Completed = { request: Request; report: Report; specification: string }
export type PythonExecutionPanelProps = {
  source: string
  plan?: unknown
  prompt?: string
  suggestedCases?: readonly { input: string; expected: string }[]
  requirements?: readonly string[]
  contextKey?: string
  onEvidenceChange?: (evidence: BrowserExecutionEvidence | null) => void
}

function jsonValue(text: string): JSONValue {
  const value: unknown = JSON.parse(text)
  const valid = (item: unknown, depth = 0): boolean => {
    if (depth > 32) return false
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true
    if (typeof item === 'number') return Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item))
    if (Array.isArray(item)) return item.every((entry) => valid(entry, depth + 1))
    return typeof item === 'object' && Object.values(item).every((entry) => valid(entry, depth + 1))
  }
  if (!valid(value)) throw new Error('Use finite JSON values, safe integers, and at most 32 nesting levels.')
  return value as JSONValue
}

function jsonArgs(text: string): JSONValue[] {
  const value = jsonValue(text)
  if (!Array.isArray(value)) throw new Error('JSON arguments must be an array, such as [9].')
  return value
}

function display(value: JSONValue | undefined) {
  return value === undefined ? '(not returned)' : JSON.stringify(value, null, 2)
}

function duration(value: number) {
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`
}

export function PythonExecutionPanel({ source, plan, prompt, suggestedCases = [], requirements = [], contextKey = '', onEvidenceChange }: PythonExecutionPanelProps) {
  const [mode, setMode] = useState<'script' | 'function'>('script')
  const [stdin, setStdin] = useState('')
  const [functionName, setFunctionName] = useState('is_prime')
  const [args, setArgs] = useState('[]')
  const nextId = useRef(2)
  const [cases, setCases] = useState<DraftCase[]>([{ id: 'case-1', input: '', expected: '', asserted: false, requirementIndices: [] }])
  const [working, setWorking] = useState(false)
  const [status, setStatus] = useState('Ready for a local self-check.')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [comparison, setComparison] = useState('')
  const [completed, setCompleted] = useState<Completed | null>(null)
  const baseline = useRef<Partial<Record<Request['operation'], Completed>>>({})
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const latestTestEvidence = useRef<BrowserExecutionEvidence | null>(null)
  const evidenceCallback = useRef(onEvidenceChange)
  evidenceCallback.current = onEvidenceChange
  const requirementContext = JSON.stringify([contextKey, requirements])
  const previousRequirementContext = useRef(requirementContext)

  function invalidate(message = 'Source or inputs changed. Run again for current results.', preserveTestEvidence = false) {
    generation.current += 1
    controller.current?.abort()
    controller.current = null
    setWorking(false)
    setCompleted(null)
    setComparison('')
    setError('')
    setNotice('')
    setStatus(message)
    if (!preserveTestEvidence) {
      latestTestEvidence.current = null
      evidenceCallback.current?.(null)
    }
  }

  useLayoutEffect(() => {
    if (previousRequirementContext.current !== requirementContext) {
      previousRequirementContext.current = requirementContext
      setCases((current) => current.map((item) => ({ ...item, requirementIndices: [] })))
    }
    invalidate()
  }, [source, plan, prompt, requirementContext])

  useLayoutEffect(() => () => {
    generation.current += 1
    controller.current?.abort()
  }, [])

  function editCase(id: string, update: Partial<DraftCase>) {
    invalidate()
    setCases((current) => current.map((item) => item.id === id ? { ...item, ...update } : item))
  }

  async function execute(operation: 'syntax' | 'run' | 'test') {
    if (working) return
    invalidate(undefined, operation !== 'test')
    let request: Request
    try {
      if (operation !== 'syntax' && mode === 'function' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionName)) {
        throw new Error('Function name must be a simple Python identifier.')
      }
      let inputs: PythonTestCase[] = []
      if (operation === 'syntax') {
        inputs = [{ id: 'syntax' }]
      } else if (operation === 'run') {
        inputs = [mode === 'script' ? { id: 'run', stdin } : { id: 'run', args: jsonArgs(args) }]
      } else if (operation === 'test') {
        if (!cases.length || cases.length > 10) throw new Error('Provide between 1 and 10 cases.')
        inputs = cases.map((item, index) => {
          if (!item.asserted) throw new Error(`Case ${index + 1}: enable an expected-value assertion before running tests.`)
          try {
            return mode === 'script'
              ? { id: item.id, stdin: item.input, expected: item.expected }
              : { id: item.id, args: jsonArgs(item.input), expected: jsonValue(item.expected) }
          } catch (reason) {
            throw new Error(`Case ${index + 1}: ${reason instanceof Error ? reason.message : 'Invalid JSON.'}`)
          }
        })
      }
      request = {
        source, operation, mode: operation === 'syntax' ? 'script' : mode, cases: inputs,
        ...(operation !== 'syntax' && mode === 'function' ? { functionName } : {}),
      }
      validateRequest(request)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Check the inputs.')
      setStatus('Inputs need attention; Python was not run.')
      return
    }
    const current = generation.current
    const evidenceRequirements = [...requirements]
    const evidenceLinks = Object.fromEntries(cases.map((item) => [item.id, [...item.requirementIndices]]))
    const evidenceContext = contextKey
    const abort = new AbortController()
    controller.current = abort
    setWorking(true)
    setStatus(operation === 'syntax' ? 'Checking syntax; program statements are not executed.' : 'Preparing browser Python...')
    try {
      const { runPython } = await import('./execution/client')
      if (abort.signal.aborted || current !== generation.current) return
      const report = await runPython(request, {
        signal: abort.signal,
        onProgress: ({ completed: count, total }) => {
          if (!abort.signal.aborted && current === generation.current) setStatus(`Processed ${count} of ${total} cases.`)
        },
      })
      if (abort.signal.aborted || current !== generation.current) return
      const specification = JSON.stringify([request.mode, request.functionName, request.cases])
      const previous = baseline.current[operation]
      if (previous && previous.request.source !== request.source && previous.report.sourceHash !== report.sourceHash
        && previous.specification === specification && previous.report.suiteHash === report.suiteHash
        && previous.request.operation === operation) {
        if (operation === 'test') {
          const failing = new Set(previous.report.results.filter((item) =>
            ['failed', 'syntax_error', 'runtime_error', 'timeout', 'output_limit', 'memory_limit'].includes(item.status),
          ).map((item) => item.id))
          const fixed = report.results.filter((item) => failing.has(item.id) && item.status === 'passed').length
          if (fixed) setComparison(`This revision passes ${fixed} previously failing ${fixed === 1 ? 'case' : 'cases'} for these inputs`)
        } else if (operation === 'run' && previous.report.results.some((item) => item.status === 'runtime_error')
          && report.results.length === 1 && report.results[0].status === 'completed' && !report.results[0].error) {
          setComparison('Previous error did not occur on this input')
        }
      }
      const next = { request, report, specification }
      baseline.current[operation] = next
      setCompleted(next)
      const evidence: BrowserExecutionEvidence = { request, report, requirements: evidenceRequirements,
        caseRequirementIndices: evidenceLinks, contextKey: evidenceContext }
      if (operation === 'test') {
        latestTestEvidence.current = evidence
        evidenceCallback.current?.(evidence)
      } else if (!latestTestEvidence.current) {
        evidenceCallback.current?.(evidence)
      }
      setStatus(operation === 'test'
        ? `${report.passed} passed, ${report.failed} failed for these asserted inputs.`
        : operation === 'syntax'
          ? report.results.some((item) => item.status !== 'completed' && item.status !== 'passed')
            ? 'Syntax check did not complete successfully.' : 'Syntax check completed; no program statements executed.'
          : report.failed ? 'Run failed. See the traceback or resource-limit details below. No expected-value assertion was made.'
            : 'Run finished. No expected-value assertion was made.')
    } catch (reason) {
      if (abort.signal.aborted || current !== generation.current) return
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setStatus('Execution stopped. No current result.')
      } else {
        setError(`Browser Python could not complete: ${reason instanceof Error ? reason.message : 'Unknown engine error'}. Check Web Worker/WebAssembly support and the runtime download, then retry.`)
        setStatus('Execution unavailable; no successful result.')
      }
    } finally {
      if (current === generation.current) {
        controller.current = null
        setWorking(false)
      }
    }
  }

  function importSuggestions() {
    invalidate()
    const imported: DraftCase[] = []
    let selectedName = ''
    for (const suggestion of suggestedCases) {
      if (imported.length >= 10 || /^(confirm|define|decide)\b/i.test(suggestion.expected.trim())) continue
      try {
        let input: string
        let expected = suggestion.expected
        if (mode === 'script') {
          input = suggestion.input.trim()
          if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(input) || typeof jsonValue(input) !== 'number') continue
        } else {
          const match = /^([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(suggestion.input.trim())
          if (!match || (selectedName && selectedName !== match[1])) continue
          input = JSON.stringify(jsonArgs(`[${match[2]}]`))
          expected = expected.trim() === 'True' ? 'true' : expected.trim() === 'False' ? 'false' : expected
          expected = JSON.stringify(jsonValue(expected))
          selectedName = match[1]
        }
        imported.push({ id: `case-${nextId.current++}`, input, expected, asserted: true, requirementIndices: [] })
      } catch {
        continue
      }
    }
    if (imported.length) {
      setCases(imported)
      if (selectedName) setFunctionName(selectedName)
    }
    setNotice(`Imported ${imported.length} suggested cases; skipped ${suggestedCases.length - imported.length} unsupported or placeholder cases. Nothing was executed. Review these assertions before testing.`)
  }

  return <section id="python-execution" className="python-execution" aria-labelledby="python-execution-heading">
    <div className="python-execution-heading"><Play size={18} aria-hidden="true" /><h2 id="python-execution-heading">Run and test Python</h2><span>LOCAL SELF-CHECK</span></div>
    <p className="python-execution-note">CPython 3.14.9 runs in an isolated browser worker, not on the server. First use downloads about 41 MB before HTTP compression. No AI or paid calls. Limits: 3 seconds per case, 256 MiB linear memory, 64 KiB output, 10 cases. Network and filesystem writes are unavailable.</p>
    <div className="python-resource-chips" aria-hidden="true"><span>3 s / case</span><span>256 MiB memory</span><span>64 KiB output</span><span>10 cases max</span></div>
    <div className="python-execution-fields">
      <label>Execution mode<select value={mode} onChange={(event) => { invalidate(); setMode(event.target.value as 'script' | 'function') }}><option value="script">Script (stdin/stdout)</option><option value="function">Function (JSON arguments)</option></select></label>
      {mode === 'script'
        ? <label>Program input (stdin)<textarea aria-label="Program input (stdin)" maxLength={8192} value={stdin} onChange={(event) => { invalidate(); setStdin(event.target.value) }} /></label>
        : <><label>Function name<input maxLength={128} value={functionName} onChange={(event) => { invalidate(); setFunctionName(event.target.value) }} /></label><label>Run JSON arguments<textarea aria-label="Run JSON arguments" maxLength={8192} value={args} onChange={(event) => { invalidate(); setArgs(event.target.value) }} /></label></>}
    </div>
    <div className="python-execution-actions">
      <button className="python-action-secondary" disabled={working} onClick={() => void execute('syntax')}><Check size={15} />Check syntax</button>
      <button className="python-action-primary" disabled={working} onClick={() => void execute('run')}><Play size={15} />Run Python</button>
      <button className="python-action-secondary" disabled={working} onClick={() => void execute('test')}><FlaskConical size={15} />Run tests</button>
      <button className="python-action-stop" disabled={!working} onClick={() => invalidate('Execution stopped. No current result.')}><Square size={15} />Stop</button>
    </div>
    <h3>Input assertions</h3>
    <p className="python-execution-note">Expected values are your assertions, not automatically proven answers. A run without an assertion is completed, not passed. Browser self-checks do not award achievements or server-verified test credit.</p>
    {requirements.length > 0 && <div className="python-requirement-help">
      <p className="python-execution-note">To update Requirement coverage, link each case to the requirements it checks, then Run tests. Links are your selections, not automatic proof of a requirement. For scripts, expected stdout includes any text printed by input prompts.</p>
      <button type="button" disabled={working} onClick={() => {
        invalidate('Requirements linked. Run tests to update coverage.')
        setCases((current) => current.map((item) => ({ ...item, requirementIndices: requirements.map((_, index) => index) })))
      }}>Link all requirements</button>
    </div>}
    {cases.map((item, index) => <fieldset className="python-case" key={item.id}>
      <legend>Case {index + 1}</legend>
      <div className="python-execution-fields">
        <label>{mode === 'script' ? `Case ${index + 1} stdin` : `Case ${index + 1} JSON arguments`}<textarea aria-label={mode === 'script' ? `Case ${index + 1} stdin` : `Case ${index + 1} JSON arguments`} maxLength={8192} value={item.input} onChange={(event) => editCase(item.id, { input: event.target.value })} /></label>
        <label>{mode === 'script' ? `Case ${index + 1} expected output` : `Case ${index + 1} expected JSON value`}<textarea aria-label={mode === 'script' ? `Case ${index + 1} expected output` : `Case ${index + 1} expected JSON value`} maxLength={8192} value={item.expected} onChange={(event) => editCase(item.id, { expected: event.target.value })} /></label>
      </div>
      <div className="python-case-actions"><label><input type="checkbox" checked={item.asserted} onChange={(event) => editCase(item.id, { asserted: event.target.checked })} />Assert expected value for case {index + 1}</label><button aria-label={`Remove case ${index + 1}`} title={`Remove case ${index + 1}`} disabled={working || cases.length <= 1} onClick={() => { invalidate(); setCases((current) => current.filter((row) => row.id !== item.id)) }}><Trash2 size={15} /></button></div>
      {requirements.length > 0 && <details className="python-requirement-links">
        <summary>Requirements checked by case {index + 1} ({item.requirementIndices.length} linked)</summary>
        <div className="python-requirement-options">{requirements.map((requirement, requirementIndex) => <label key={requirementIndex}>
          <input type="checkbox" aria-label={`Case ${index + 1} requirement ${requirementIndex + 1}: ${requirement}`}
            checked={item.requirementIndices.includes(requirementIndex)} onChange={(event) => editCase(item.id, {
              requirementIndices: event.target.checked ? [...item.requirementIndices, requirementIndex] : item.requirementIndices.filter((value) => value !== requirementIndex),
            })} /><span>{requirement}</span>
        </label>)}</div>
      </details>}
    </fieldset>)}
    <div className="python-execution-actions"><button disabled={working || cases.length >= 10} onClick={() => { invalidate(); setCases((current) => [...current, { id: `case-${nextId.current++}`, input: mode === 'function' ? '[]' : '', expected: '', asserted: false, requirementIndices: [] }]) }}><Plus size={15} />Add case</button><button disabled={working || !suggestedCases.length} onClick={importSuggestions}>Use suggested cases</button></div>
    <p className="python-execution-status" role="status" aria-label="Python execution status" aria-live="polite" aria-busy={working}>{status}</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="python-execution-error">{error}</p>}
    {comparison && <p className="python-revision" role="status">{comparison}</p>}
    {completed && <div className="python-execution-results" aria-label="Python execution results">
      <p className="python-execution-note">{completed.report.engine} / {completed.report.runtimeVersion} / {duration(completed.report.durationMs)}</p>
      {completed.report.results.map((result) => {
        const input = completed.request.cases.find((item) => item.id === result.id)
        return <article className={`python-result python-result-${result.status}`} key={result.id}>
          <h4>{result.id}: {completed.request.operation !== 'test' && result.status === 'passed' ? 'completed' : result.status.replace(/_/g, ' ')}</h4>
          <p>Exit code: {result.exitCode === null ? 'none' : result.exitCode} / {duration(result.durationMs)}</p>
          {result.error && <p className="python-execution-error">{result.error.type}{result.error.line !== undefined ? ` at line ${result.error.line}` : ''}: {result.error.message}</p>}
          <div className="python-execution-fields"><div><h5>stdout</h5><pre>{result.stdout || '(empty)'}</pre></div><div><h5>stderr / traceback</h5><pre>{result.stderr || '(empty)'}</pre></div></div>
          {completed.request.operation !== 'syntax' && <div className="python-execution-fields"><div><h5>Actual {completed.request.mode === 'script' ? 'output' : 'JSON value'}</h5><pre>{completed.request.mode === 'script' ? JSON.stringify(result.stdout) : display(result.actual)}</pre></div>{input && Object.prototype.hasOwnProperty.call(input, 'expected') && <div><h5>Expected {completed.request.mode === 'script' ? 'output' : 'JSON value'}</h5><pre>{display(input.expected)}</pre></div>}</div>}
        </article>
      })}
    </div>}
  </section>
}