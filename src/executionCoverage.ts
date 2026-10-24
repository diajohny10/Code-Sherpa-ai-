import type { BrowserExecutionEvidence } from './executionEvidence'
import type { PythonCaseResult } from './execution/types'

export type ExecutedCoverageStatus = 'PASSED' | 'MISSING' | 'UNTESTED'
export type ExecutedCoverageCase = { id: string; asserted: boolean; outcome: string; status: ExecutedCoverageStatus }
export type ExecutedCoverageReport = {
  score: number | null
  passed: number
  failing: number
  untested: number
  testsPassed: number
  testsTotal: number
  unlinkedTests: number
  unlinkedFailures: number
  evidenceState: 'none' | 'syntax' | 'run' | 'test'
  requirements: { requirement: string; status: ExecutedCoverageStatus; explanation: string; cases: ExecutedCoverageCase[] }[]
}

const failures = new Set(['failed', 'runtime_error', 'syntax_error', 'timeout', 'output_limit', 'memory_limit'])
const limits = new Set(['timeout', 'output_limit', 'memory_limit'])

function resultStatus(result: PythonCaseResult | undefined, asserted: boolean): ExecutedCoverageStatus {
  if (!asserted || !result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
    || !Number.isFinite(result.durationMs) || result.durationMs < 0
    || !(result.exitCode === null || Number.isInteger(result.exitCode))) return 'UNTESTED'
  if (failures.has(result.status)) return 'MISSING'
  return result.status === 'passed' && result.exitCode === 0 ? 'PASSED' : 'UNTESTED'
}

export function calculateExecutedCoverage(
  requirements: readonly string[], source: string, contextKey: string, evidence: BrowserExecutionEvidence | null,
): ExecutedCoverageReport {
  const current = evidence !== null && evidence.request?.source === source && evidence.contextKey === contextKey
    && Array.isArray(evidence.requirements) && evidence.requirements.length === requirements.length
    && requirements.every((label, index) => label === evidence.requirements[index])
    && evidence.report?.operation === evidence.request.operation && evidence.report?.mode === evidence.request.mode
    && evidence.report.engine === 'cpython-wasi'
    && ['script', 'function'].includes(evidence.request.mode)
    && ['syntax', 'run', 'test'].includes(evidence.request.operation)
    && Array.isArray(evidence.request.cases) && Array.isArray(evidence.report.results)
  const evidenceState = current ? evidence.request.operation : 'none'
  const cases = current && evidenceState === 'test' ? evidence.request.cases : []
  const results = current && evidenceState === 'test' ? evidence.report.results : []
  const requestCounts = new Map<string, number>()
  const resultCounts = new Map<string, number>()
  for (const item of cases) if (item && typeof item.id === 'string') requestCounts.set(item.id, (requestCounts.get(item.id) ?? 0) + 1)
  for (const item of results) if (item && typeof item.id === 'string') resultCounts.set(item.id, (resultCounts.get(item.id) ?? 0) + 1)
  const observations = cases.flatMap((item): (ExecutedCoverageCase & { indices: number[] })[] => {
    if (!item || typeof item.id !== 'string' || !item.id) return []
    const result = requestCounts.get(item.id) === 1 && resultCounts.get(item.id) === 1
      ? results.find((entry) => entry?.id === item.id) : undefined
    const asserted = Object.prototype.hasOwnProperty.call(item, 'expected') && item.expected !== undefined
    const status = resultStatus(result, asserted)
    const links = evidence?.caseRequirementIndices && Object.prototype.hasOwnProperty.call(evidence.caseRequirementIndices, item.id)
      ? evidence.caseRequirementIndices[item.id] : []
    const indices = Array.isArray(links) ? [...new Set(links.filter((index) => Number.isInteger(index) && index >= 0 && index < requirements.length))] : []
    return [{ id: item.id, asserted, status, indices, outcome: status === 'UNTESTED'
      ? `${result?.status ?? 'missing result'} (no usable assertion evidence)` : result!.status }]
  })
  const rows = requirements.map((requirement, index) => {
    const linked = observations.filter((item) => item.indices.includes(index))
    const status: ExecutedCoverageStatus = linked.some((item) => item.status === 'MISSING') ? 'MISSING'
      : linked.length > 0 && linked.every((item) => item.status === 'PASSED') ? 'PASSED' : 'UNTESTED'
    const explanation = !linked.length
      ? 'No linked test evidence; add expected outputs and link requirements in Run and test Python.'
      : status === 'PASSED' ? 'All linked assertions passed for the selected inputs.'
        : status === 'MISSING' ? linked.some((item) => limits.has(item.outcome))
          ? 'A linked test reached a resource limit. This does not prove the implementation is wrong for all inputs.'
          : 'A linked assertion failed or execution raised an error for the selected inputs.'
          : 'Linked evidence is incomplete or unavailable. Every linked test needs a completed expected-value assertion.'
    return { requirement, status, explanation, cases: linked.map(({ indices: _indices, ...item }) => item) }
  })
  const passed = rows.filter((row) => row.status === 'PASSED').length
  const failing = rows.filter((row) => row.status === 'MISSING').length
  const hasLinkedEvidence = observations.some((item) => item.indices.length > 0 && item.status !== 'UNTESTED')
  return {
    score: hasLinkedEvidence && requirements.length > 0 ? Math.round(passed / requirements.length * 100) : null,
    passed, failing, untested: requirements.length - passed - failing,
    testsPassed: observations.filter((item) => item.status === 'PASSED').length,
    testsTotal: observations.filter((item) => item.asserted).length,
    unlinkedTests: observations.filter((item) => item.asserted && !item.indices.length).length,
    unlinkedFailures: observations.filter((item) => item.asserted && !item.indices.length && item.status === 'MISSING').length,
    evidenceState, requirements: rows,
  }
}