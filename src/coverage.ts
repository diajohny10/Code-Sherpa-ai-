export type CoverageStatus = 'PASSED' | 'MISSING' | 'UNTESTED'
export const MAX_FIXTURE_MAGNITUDE = 1_000_000_000

export type CoverageCase = { input: string; expected: string }
export type RequirementCoverage = {
  requirement: string
  status: CoverageStatus
  cases: { input: string; expected: string; observed: string | null; status: CoverageStatus }[]
  explanation: string
}
export type CoverageReport = {
  score: number
  passed: number
  missing: number
  untested: number
  requirements: RequirementCoverage[]
  evidence: 'deterministic-demo-fixtures'
}

function fixtureResult(challengeId: string, input: string): string | null {
  const parsed = input.trim().match(/^(?:(is_prime|is_even|is_odd|is_parity)\(\s*(-?\d+)\s*\)|(-?\d+))$/i)
  if (!parsed) return null
  const number = Number(parsed[2] ?? parsed[3])
  if (!Number.isSafeInteger(number) || Math.abs(number) > MAX_FIXTURE_MAGNITUDE) return null
  const functionName = parsed[1]?.toLowerCase()
  if (functionName && (challengeId === 'prime' ? functionName !== 'is_prime' : functionName === 'is_prime')) return null

  if (challengeId === 'prime') {
    if (number < 2) return 'false'
    if (number === 2) return 'true'
    if (number % 2 === 0) return 'false'
    for (let divisor = 3; divisor * divisor <= number; divisor += 2) {
      if (number % divisor === 0) return 'false'
    }
    return 'true'
  }
  if (challengeId === 'parity') {
    if (/is_even/i.test(input)) return String(number % 2 === 0)
    if (/is_odd/i.test(input)) return String(Math.abs(number % 2) === 1)
    return number % 2 === 0 ? 'even' : 'odd'
  }
  return null
}

function relevantCaseIndices(challengeId: string, requirement: string, cases: CoverageCase[], observed: (string | null)[]): number[] {
  const label = requirement.toLowerCase()
  return cases.flatMap((item, index) => {
    const match = item.input.match(/(-?\d+)/)
    const number = match ? Number(match[1]) : null
    if (challengeId === 'prime') {
      if (/below 2|less than 2|numbers? less|small values/.test(label)) return number !== null && number < 2 ? [index] : []
      if (/no divisor|no factor|without divisor/.test(label)) {
        return number !== null && (observed[index] === 'true' || observed[index] === null) ? [index] : []
      }
      if (/divisor|factor/.test(label) && /false|any divisor|factor is found/.test(label)) {
        return number !== null && number > 1 && (observed[index] === 'false' || observed[index] === null) ? [index] : []
      }
      if (/candidate|starting at 2|check.*divisor/.test(label)) {
        return number !== null && number > 2 ? [index] : []
      }
      if (/prime|no divisor|no factor|handle 2/.test(label)) {
        return number !== null && (observed[index] === 'true' || observed[index] === null) ? [index] : []
      }
    }
    if (challengeId === 'parity') {
      if (/zero|negative/.test(label)) return number !== null && (number === 0 || number < 0) ? [index] : []
      if (/classify|remainder/.test(label)) return [index]
      if (/even|divisible/.test(label)) return item.expected.toLowerCase() === 'even' || item.expected.toLowerCase() === 'true' ? [index] : []
      if (/odd|non-zero/.test(label)) return item.expected.toLowerCase() === 'odd' || item.expected.toLowerCase() === 'true' ? [index] : []
    }
    return challengeId === 'custom' ? [index] : []
  })
}

/**
 * Scores only deterministic reference fixtures for known prime/parity prompts.
 * This never examines or executes learner source; unknown prompts remain UNTESTED.
 */
export function calculateRequirementCoverage(
  challengeId: string,
  requirements: string[],
  cases: CoverageCase[],
): CoverageReport {
  const cache = new Map<string, string | null>()
  const observedCases = cases.map((item) => {
    if (!cache.has(item.input)) cache.set(item.input, fixtureResult(challengeId, item.input))
    return cache.get(item.input) ?? null
  })
  const rows = requirements.map((requirement): RequirementCoverage => {
    const indices = relevantCaseIndices(challengeId, requirement, cases, observedCases)
    const caseRows = indices.map((index) => {
      const item = cases[index]
      const observed = observedCases[index]
      const expected = item.expected.trim().toLowerCase()
      const status: CoverageStatus = observed === null
        ? 'UNTESTED'
        : observed === expected ? 'PASSED' : 'MISSING'
      return { ...item, observed, status }
    })
    const status: CoverageStatus = caseRows.length === 0 || caseRows.every((item) => item.status === 'UNTESTED')
      ? 'UNTESTED'
      : caseRows.some((item) => item.status === 'MISSING') ? 'MISSING'
        : caseRows.every((item) => item.status === 'PASSED') ? 'PASSED' : 'UNTESTED'
    const explanation = status === 'PASSED'
      ? 'Associated deterministic reference cases matched their expected values. This does not test your submitted code.'
      : status === 'MISSING'
        ? 'At least one associated expected value conflicts with the deterministic reference fixture; review the suggestion.'
        : 'No matching deterministic reference test can verify this requirement; it remains untested.'
    return { requirement, status, cases: caseRows, explanation }
  })
  const passed = rows.filter((row) => row.status === 'PASSED').length
  const missing = rows.filter((row) => row.status === 'MISSING').length
  const untested = rows.filter((row) => row.status === 'UNTESTED').length
  return {
    score: rows.length ? Math.round((passed / rows.length) * 100) : 0,
    passed, missing, untested, requirements: rows, evidence: 'deterministic-demo-fixtures',
  }
}
