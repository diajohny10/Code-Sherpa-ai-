import type { PythonExecutionReport, PythonExecutionRequest } from './execution/types'

/** Local, user-mapped test evidence. Never a server-attested correctness claim. */
export type BrowserExecutionEvidence = {
  request: PythonExecutionRequest
  report: PythonExecutionReport
  requirements: readonly string[]
  caseRequirementIndices: Record<string, number[]>
  contextKey: string
}
