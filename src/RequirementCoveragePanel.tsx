import { ArrowDown, FlaskConical } from 'lucide-react'
import type { CoverageReport } from './coverage'
import { calculateExecutedCoverage } from './executionCoverage'
import type { BrowserExecutionEvidence } from './executionEvidence'

export type RequirementCoveragePanelProps = {
  requirements: readonly string[]
  source: string
  contextKey: string
  evidence: BrowserExecutionEvidence | null
  referenceReport?: CoverageReport
}

function focusTests() {
  const target = document.getElementById('python-execution')
  if (!target) return
  target.tabIndex = -1
  target.focus({ preventScroll: true })
  target.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth', block: 'start' })
}

export function RequirementCoveragePanel({ requirements, source, contextKey, evidence, referenceReport }: RequirementCoveragePanelProps) {
  const report = calculateExecutedCoverage(requirements, source, contextKey, evidence)
  const score = report.score === null ? 'Not tested' : `${report.score}/100`
  return (
    <section id="requirement-coverage" className="panel requirements-panel executed-coverage" aria-label="Requirement coverage" tabIndex={-1}>
      <div className="panel-heading">
        <div className="mini-icon green"><FlaskConical size={15} /></div>
        <div><h3>Requirement coverage</h3><span className="execution-evidence-badge">Browser test evidence</span></div>
        <span className={`coverage-score ${report.score === null ? 'coverage-not-tested' : ''}`} aria-label="Requirement test coverage score">{score}</span>
      </div>
      {report.unlinkedTests > 0 && <p className="coverage-caption">{report.unlinkedTests} asserted tests have no requirement links and do not affect this requirement score{report.unlinkedFailures ? `, including ${report.unlinkedFailures} failing tests` : ''}. Link the relevant requirements in the test cases below.</p>}
      <div role="status" aria-label="Requirement coverage status" aria-live="polite">
        <p className="coverage-caption">{report.evidenceState === 'test'
          ? `${report.testsPassed}/${report.testsTotal} asserted tests passed.`
          : report.evidenceState === 'none' ? 'No current browser test evidence.' : 'Syntax checks and plain runs do not test requirements. Add expected outputs and run tests.'}</p>
        <div className="coverage-totals"><span><b>{report.passed}</b> passing</span><span><b>{report.failing}</b> failing</span><span><b>{report.untested}</b> untested</span></div>
      </div>
      {report.score !== null && <><div className="progress-track"><span style={{ width: `${report.score}%` }} /></div><p className="coverage-formula">Score = requirements with passing linked tests / all requirements x 100</p></>}
      {report.score === null && <p className="coverage-caption">Add expected outputs and link requirements in Run and test Python.</p>}
      <button type="button" className="hint-button coverage-link-button" onClick={focusTests}><ArrowDown size={14} /> Link and run tests</button>
      <div className="requirement-list">{report.requirements.map((item, index) => (
        <article className="coverage-requirement" key={`${index}-${item.requirement}`}>
          <div className="coverage-requirement-heading"><span>{item.requirement}</span><b className={`coverage-status status-${item.status.toLowerCase()}`}>{item.status === 'PASSED' ? 'TESTS PASSED' : item.status === 'MISSING' ? 'FAILING' : 'UNTESTED'}</b></div>
          <p>{item.explanation}</p>
          {item.cases.length > 0 && <ul className="execution-coverage-cases" aria-label={`Linked tests for requirement ${index + 1}`}>{item.cases.map((testCase, caseIndex) => <li key={`${testCase.id}-${caseIndex}`}><code>{testCase.id}</code>: {testCase.outcome.replace(/_/g, ' ')}{!testCase.asserted && ' (no expected output)'}</li>)}</ul>}
        </article>
      ))}</div>
      <p className="coverage-disclaimer">Passing mapped tests are evidence for selected inputs, not proof of semantic implementation correctness or server-verified grades.</p>
      {referenceReport && <details className="reference-coverage"><summary>Reference examples (not your code)</summary>
        <p className="coverage-caption">Illustrative reference-fixture score: {referenceReport.score}/100. These examples do not execute your code.</p>
        <p className="coverage-caption">Reference examples: {referenceReport.passed} matched, {referenceReport.missing} conflicting, {referenceReport.untested} unsupported. This is not the requirement score for your submitted program.</p>
      </details>}
    </section>
  )
}