import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateExecutedCoverage } from '../src/executionCoverage'
import { RequirementCoveragePanel } from '../src/RequirementCoveragePanel'
import type { BrowserExecutionEvidence } from '../src/executionEvidence'
import type { PythonCaseStatus } from '../src/execution/types'
import type { CoverageReport } from '../src/coverage'

const source = 'word = input()\nprint(word == word[::-1])'
const requirements = ['Recognize palindromes', 'Reject non-palindromes']
function evidence(): BrowserExecutionEvidence {
  return {
    contextKey: 'palindrome-v1', requirements: [...requirements],
    request: { source, operation: 'test', mode: 'script', cases: [{ id: 'word', stdin: 'radar', expected: 'True' }, { id: 'other', stdin: 'hello', expected: 'False' }] },
    report: { engine: 'cpython-wasi', runtimeVersion: '3.14.9', operation: 'test', mode: 'script', sourceHash: 'snapshot-hash', suiteHash: 'suite-hash',
      results: [{ id: 'word', status: 'passed', stdout: 'True', stderr: '', exitCode: 0, durationMs: 1 }, { id: 'other', status: 'passed', stdout: 'False', stderr: '', exitCode: 0, durationMs: 1 }],
      passed: 2, failed: 0, allPassed: true, durationMs: 2 },
    caseRequirementIndices: { word: [0], other: [1] },
  }
}
const calculate = (value: BrowserExecutionEvidence | null) => calculateExecutedCoverage(requirements, source, 'palindrome-v1', value)
const panelProps = { requirements, source, contextKey: 'palindrome-v1' }
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('executed requirement coverage', () => {
  it('starts a correct-looking palindrome source as untested without executing or inspecting it', () => {
    expect(calculate(null)).toMatchObject({ score: null, passed: 0, untested: 2 })
    render(<RequirementCoveragePanel {...panelProps} evidence={null} />)
    expect(screen.getByLabelText('Requirement test coverage score').textContent).toBe('Not tested')
    expect(screen.getAllByText('UNTESTED')).toHaveLength(2)
    expect(screen.getAllByText(/No linked test evidence/)).toHaveLength(2)
  })

  it('uses mapped current assertions and clears synchronously on source edits', () => {
    const value = evidence()
    expect(calculate(value)).toMatchObject({ score: 100, passed: 2, testsPassed: 2 })
    const view = render(<RequirementCoveragePanel {...panelProps} evidence={value} />)
    expect(screen.getAllByText('TESTS PASSED')).toHaveLength(2)
    expect(screen.getByLabelText('Linked tests for requirement 1').textContent).toContain('word: passed')
    view.rerender(<RequirementCoveragePanel {...panelProps} source={`${source}\n# edit`} evidence={value} />)
    expect(screen.getByLabelText('Requirement test coverage score').textContent).toBe('Not tested')
    expect(screen.queryByText('TESTS PASSED')).toBeNull()
  })

  it('counts passing requirements against all requirements, never unmapped ones', () => {
    const value = evidence()
    value.caseRequirementIndices = { word: [0] }
    expect(calculate(value)).toMatchObject({ score: 50, passed: 1, untested: 1 })
    value.caseRequirementIndices = {}
    expect(calculate(value)).toMatchObject({ score: null, testsPassed: 2, passed: 0 })
    render(<RequirementCoveragePanel {...panelProps} evidence={value} />)
    expect(screen.getByRole('status', { name: 'Requirement coverage status' }).textContent).toContain('2/2 asserted tests passed')
    expect(screen.getByLabelText('Requirement test coverage score').textContent).toBe('Not tested')
  })

  it('ignores stale contexts, changed labels/order, operation mismatches and mode mismatches', () => {
    const value = evidence()
    expect(calculateExecutedCoverage(requirements, source, 'new-version', value).score).toBeNull()
    expect(calculateExecutedCoverage([...requirements].reverse(), source, value.contextKey, value).score).toBeNull()
    expect(calculateExecutedCoverage(['New label', requirements[1]], source, value.contextKey, value).score).toBeNull()
    value.report.mode = 'function'
    expect(calculate(value).score).toBeNull()
    value.report.mode = 'script'
    value.report.operation = 'run'
    expect(calculate(value).score).toBeNull()
  })

  it.each(['syntax', 'run'] as const)('does not score a successful %s operation', (operation) => {
    const value = evidence()
    value.request.operation = operation
    value.report.operation = operation
    expect(calculate(value)).toMatchObject({ score: null, passed: 0, untested: 2 })
    render(<RequirementCoveragePanel {...panelProps} evidence={value} />)
    expect(screen.getByRole('status', { name: 'Requirement coverage status' }).textContent).toContain('do not test requirements')
  })

  it.each(['failed', 'runtime_error', 'syntax_error', 'timeout', 'output_limit', 'memory_limit'] satisfies PythonCaseStatus[])('reports %s as failing evidence, not a whole-program verdict', (status) => {
    const value = evidence()
    value.report.results.forEach((result) => { result.status = status; result.exitCode = 1 })
    expect(calculate(value)).toMatchObject({ score: 0, failing: 2, passed: 0 })
    if (['timeout', 'output_limit', 'memory_limit'].includes(status)) expect(calculate(value).requirements[0].explanation).toContain('resource limit')
  })

  it.each(['unsupported', 'cancelled', 'engine_error', 'completed'] satisfies PythonCaseStatus[])('keeps %s untested even when linked alongside a pass', (status) => {
    const value = evidence()
    value.caseRequirementIndices.other = [0]
    value.report.results[1].status = status
    expect(calculate(value).requirements[0].status).toBe('UNTESTED')
    expect(calculate(value).passed).toBe(0)
  })

  it('does not turn partial, duplicate or malformed results into passing rows', () => {
    const value = evidence()
    value.caseRequirementIndices.other = [0]
    value.report.results.pop()
    expect(calculate(value).requirements[0].status).toBe('UNTESTED')
    value.report.results.push({ ...value.report.results[0] })
    expect(calculate(value).score).toBeNull()
    const malformed = evidence()
    malformed.report.results[0].durationMs = Number.NaN
    malformed.report.results[1].exitCode = null
    expect(calculate(malformed).score).toBeNull()
  })

  it('rejects duplicate request IDs and filters invalid indices while deduplicating valid links', () => {
    const value = evidence()
    value.request.cases[1].id = 'word'
    expect(calculate(value).score).toBeNull()
    const linked = evidence()
    linked.caseRequirementIndices = { word: [-1, 2, 0.5, Number.NaN], other: [99] }
    expect(calculate(linked).score).toBeNull()
    linked.caseRequirementIndices.word = [0, 0]
    expect(calculate(linked).requirements[0].cases).toHaveLength(1)
    expect(calculate(linked).score).toBe(50)
  })

  it('requires an own expected value, supports explicit null, and never trusts summary counts', () => {
    const value = evidence()
    delete value.request.cases[0].expected
    value.request.cases[1] = Object.assign(Object.create({ expected: 'False' }), { id: 'other' })
    expect(calculate(value).score).toBeNull()
    value.request.cases[0].expected = null
    value.report.passed = 0
    value.report.allPassed = false
    expect(calculate(value).score).toBe(50)
  })

  it('only navigates and focuses the existing runtime section when asked to link tests', () => {
    render(<><RequirementCoveragePanel {...panelProps} evidence={null} /><section id="python-execution">Runtime</section></>)
    fireEvent.click(screen.getByRole('button', { name: 'Link and run tests' }))
    expect(document.activeElement?.id).toBe('python-execution')
  })

  it('shows failing test labels and keeps illustrative fixture scores collapsed and separate', () => {
    const value = evidence()
    value.report.results.forEach((result) => { result.status = 'failed' })
    const referenceReport: CoverageReport = { score: 100, passed: 2, missing: 0, untested: 0, requirements: [], evidence: 'deterministic-demo-fixtures' }
    const view = render(<RequirementCoveragePanel {...panelProps} evidence={value} referenceReport={referenceReport} />)
    expect(screen.getAllByText('FAILING')).toHaveLength(2)
    expect(screen.getByLabelText('Requirement test coverage score').textContent).toBe('0/100')
    expect(screen.getByText('Reference examples (not your code)')).toBeTruthy()
    expect(view.container.querySelector('details')?.open).toBe(false)
    expect(screen.getByText(/not proof of semantic implementation correctness/)).toBeTruthy()
  })
})