import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLearningPlan,
  getExplanationFeedback,
  primeSampleCases,
  reviewPrimeSource,
  starterPrimeCode,
} from '../src/primeWorkflow.ts'

const correctedPrimeCode = `def is_prime(number):
    if number < 2:
        return False
    for divisor in range(2, number):
        if number % divisor == 0:
            return False
    return True`

test('reference examples cover the requested prime, composite, and negative inputs', () => {
  assert.deepEqual(
    primeSampleCases.map(({ input, expected }) => [input, expected]),
    [
      ['is_prime(2)', 'True'],
      ['is_prime(3)', 'True'],
      ['is_prime(4)', 'False'],
      ['is_prime(9)', 'False'],
      ['is_prime(17)', 'True'],
      ['is_prime(-1)', 'False'],
      ['is_prime(-7)', 'False'],
    ],
  )
})

test('a custom prime prompt becomes a structured local plan with edge cases and hints', () => {
  const plan = buildLearningPlan('Write a function that checks if a number is prime.')
  assert.equal(plan.id, 'prime')
  assert.equal(plan.requirements.length, 4)
  assert.ok(plan.requirements.some((item) => /below 2/.test(item)))
  assert.ok(plan.sampleCases.some((item) => item.input === 'is_prime(-7)'))
  assert.equal(plan.hints.length, 3)
  assert.match(plan.note, /not AI-generated/)

  const constrainedPlan = buildLearningPlan('Write a prime checker. It must handle a prompt-specific edge case.')
  assert.ok(constrainedPlan.requirements.some((item) => /Prompt constraint:.*must handle/.test(item)))
})

test('FizzBuzz plans include ordinary cases and the combined-rule boundary', () => {
  const plan = buildLearningPlan('Create a FizzBuzz function for multiples of 3 and 5.')
  assert.equal(plan.id, 'fizzbuzz')
  assert.ok(plan.requirements.some((item) => /combined 3-and-5/.test(item)))
  assert.deepEqual(plan.sampleCases.find((item) => item.input === 'fizzbuzz(15)'), {
    input: 'fizzbuzz(15)',
    expected: 'FizzBuzz',
  })
})

test('Armstrong prompts produce concrete deterministic cases instead of placeholders', () => {
  const plan = buildLearningPlan('Write a function to check whether a number is an Armstrong number.')
  assert.equal(plan.id, 'armstrong')
  assert.equal(plan.title, 'Armstrong number checker')
  assert.deepEqual(plan.sampleCases.map(({ input, expected }) => [input, expected]), [
    ['is_armstrong(0)', 'True'], ['is_armstrong(5)', 'True'],
    ['is_armstrong(153)', 'True'], ['is_armstrong(9474)', 'True'],
    ['is_armstrong(123)', 'False'], ['is_armstrong(-153)', 'False'],
  ])
  assert.ok(plan.hints.length >= 3)
  assert.match(plan.note, /not code execution/)
})

test('unknown custom prompts retain stated conditions and generate honest edge-case suggestions', () => {
  const plan = buildLearningPlan('Write a function that returns the total when the list is not empty.')
  assert.equal(plan.id, 'custom')
  assert.match(plan.title, /not empty/)
  assert.ok(plan.requirements.some((item) => /when the list is not empty/.test(item)))
  assert.ok(plan.sampleCases.some((item) => item.input === 'Typical input from prompt'))
  assert.ok(plan.sampleCases.some((item) => item.input === 'Boundary input' && /Define/.test(item.expected)))
  assert.ok(plan.sampleCases.some((item) => item.input === 'Empty or invalid input'))
  assert.match(plan.note, /expected outputs need your confirmation/)
})

test('starter challenge deliberately fails the divisor-return check', () => {
  const checks = reviewPrimeSource(starterPrimeCode)
  assert.equal(checks.filter((check) => check.passed).length, 3)
  assert.equal(checks.find((check) => check.id === 'divisor-result')?.passed, false)
})

test('a corrected prime solution passes all static structure checks', () => {
  assert.ok(reviewPrimeSource(correctedPrimeCode).every((check) => check.passed))
})

test('a zero remainder branch that returns True gets targeted guidance', () => {
  const incorrect = correctedPrimeCode.replace('return False\n    return True', 'return True\n    return True')
  const check = reviewPrimeSource(incorrect).find((item) => item.id === 'divisor-result')
  assert.equal(check?.passed, false)
  assert.match(check?.guidance ?? '', /return False/)
})

test('explanation feedback distinguishes a complete explanation from a partial one', () => {
  const complete = getExplanationFeedback(
    'If number % divisor == 0, the divisor is a factor, so it is not prime and return False.',
  )
  assert.equal(complete.tone, 'positive')
  assert.match(complete.message, /zero remainder/)

  const partial = getExplanationFeedback('The remainder is zero.')
  assert.equal(partial.tone, 'encouraging')
  assert.match(partial.message, /return False/)
})

test('empty or vague explanation receives a useful first step', () => {
  assert.match(getExplanationFeedback('I am not sure yet.').message, /number % divisor/)
})
