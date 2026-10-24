import assert from 'node:assert/strict'
import test from 'node:test'
import { bugCategories, bugChallenges, calculateDebugResult } from '../src/bugDetective.ts'

test('challenge set covers the four requested beginner bug categories', () => {
  assert.deepEqual(new Set(bugChallenges.map((challenge) => challenge.category)),
    new Set(bugCategories.map((category) => category.id)))
  assert.ok(bugChallenges.every((challenge) => challenge.hints.length >= 3 && challenge.fixtureCases.length >= 2))
})

test('known repair and category complete all fixtures without executing learner code', () => {
  const challenge = bugChallenges.find((item) => item.id === 'prime-return-value')
  assert.ok(challenge)
  const result = calculateDebugResult(challenge, challenge.category, 'return-false', 'Return False when a divisor is found.')
  assert.equal(result.score, 100)
  assert.equal(result.complete, true)
  assert.equal(result.fixtureCasesPassed, result.fixtureCasesTotal)
  assert.match(result.feedback, /was not run/)
})

test('wrong category or repair cannot be marked complete', () => {
  const challenge = bugChallenges[0]
  const result = calculateDebugResult(challenge, 'edge-case', 'reverse', 'I will reverse the returns.')
  assert.equal(result.score, 0)
  assert.equal(result.complete, false)
  assert.match(result.feedback, /revisit/i)
})

test('proposal text is required before completion', () => {
  const challenge = bugChallenges[1]
  const result = calculateDebugResult(challenge, challenge.category, 'inclusive-range', '  ')
  assert.equal(result.score, 100)
  assert.equal(result.complete, false)
  assert.match(result.feedback, /Write your proposed fix/)
})
