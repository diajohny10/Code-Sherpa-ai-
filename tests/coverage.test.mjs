import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_FIXTURE_MAGNITUDE, calculateRequirementCoverage } from '../src/coverage.ts'

test('prime requirement coverage associates fixture cases and shows its calculation', () => {
  const report = calculateRequirementCoverage('prime', [
    'Return False for values below 2',
    'Return False if any divisor is found',
    'Check candidate divisors starting at 2',
    'Return True when no divisor is found',
  ], [
    { input: 'is_prime(2)', expected: 'True' },
    { input: 'is_prime(3)', expected: 'True' },
    { input: 'is_prime(4)', expected: 'False' },
    { input: 'is_prime(9)', expected: 'False' },
    { input: 'is_prime(-1)', expected: 'False' },
  ])
  assert.equal(report.score, 100)
  assert.deepEqual([report.passed, report.missing, report.untested], [4, 0, 0])
  assert.ok(report.requirements.every((row) => row.status === 'PASSED' && row.cases.length > 0))
  assert.match(report.requirements[0].explanation, /does not test your submitted code/)
})

test('a conflicting expected fixture is MISSING and lowers score', () => {
  const report = calculateRequirementCoverage('prime', ['Return False for values below 2'], [
    { input: 'is_prime(-1)', expected: 'True' },
  ])
  assert.equal(report.requirements[0].status, 'MISSING')
  assert.equal(report.score, 0)
  assert.equal(report.missing, 1)
})

test('unknown custom requirements remain UNTESTED, never PASSED', () => {
  const report = calculateRequirementCoverage('custom', ['Support a user-defined rule'], [
    { input: 'Typical input', expected: 'Confirm from prompt' },
  ])
  assert.equal(report.requirements[0].status, 'UNTESTED')
  assert.equal(report.score, 0)
  assert.equal(report.untested, 1)
})

test('even odd reference fixtures cover negative values, zero, and both outcomes', () => {
  const report = calculateRequirementCoverage('parity', [
    'Classify integers by remainder after division by 2',
    'Return even for values divisible by 2',
    'Return odd for values with non-zero remainder',
    'Handle zero and negative integers consistently',
  ], [
    { input: '-4', expected: 'even' }, { input: '-3', expected: 'odd' },
    { input: '0', expected: 'even' }, { input: '2', expected: 'even' },
    { input: '3', expected: 'odd' },
  ])
  assert.equal(report.score, 100)
  assert.deepEqual([report.passed, report.missing, report.untested], [4, 0, 0])
})

test('unsupported fixture magnitudes, malformed calls, and mismatched functions stay UNTESTED', () => {
  for (const input of [`is_prime(${MAX_FIXTURE_MAGNITUDE + 1})`, `is_prime(${-MAX_FIXTURE_MAGNITUDE - 1})`,
    'is_prime(9007199254740881)', 'is_prime(2', '2)', 'is_even(2)']) {
    const report = calculateRequirementCoverage('prime', ['Check candidate divisors starting at 2', 'Return True when no divisor is found'], [{ input, expected: 'true' }])
    assert.equal(report.passed, 0, input)
    assert.equal(report.untested, 2, input)
  }
})
