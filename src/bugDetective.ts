export type BugCategory = 'incorrect-condition' | 'off-by-one' | 'incorrect-return' | 'edge-case'
export type BugChallenge = {
  id: string
  category: BugCategory
  categoryLabel: string
  title: string
  description: string
  objective: string
  buggyCode: string
  hints: string[]
  fixes: { id: string; label: string; description: string; correct: boolean }[]
  fixtureCases: { input: string; expected: string }[]
}

export type DebugResult = {
  categoryIdentified: boolean
  fixSelected: boolean
  fixtureCasesPassed: number
  fixtureCasesTotal: number
  score: number
  complete: boolean
  feedback: string
}

export const bugCategories: { id: BugCategory; label: string }[] = [
  { id: 'incorrect-condition', label: 'Incorrect condition' },
  { id: 'off-by-one', label: 'Off-by-one error' },
  { id: 'incorrect-return', label: 'Incorrect return value' },
  { id: 'edge-case', label: 'Edge-case handling' },
]

export const bugChallenges: BugChallenge[] = [
  {
    id: 'age-boundary-condition', category: 'incorrect-condition', categoryLabel: 'Incorrect condition',
    title: 'The birthday boundary',
    description: 'A person is an adult at age 18 or older, but this function puts age 18 in the minor group.',
    objective: 'Spot the boundary condition and make the comparison include age 18.',
    buggyCode: 'def age_group(age):\n    if age > 18:\n        return "adult"\n    return "minor"',
    hints: ['Try the exact boundary value, age 18.', 'The requirement says “18 or older.”', 'An inclusive comparison uses >=.'],
    fixes: [
      { id: 'inclusive', label: 'Change > to >=', description: 'Use an inclusive lower bound of 18.', correct: true },
      { id: 'higher', label: 'Change > to >= 19', description: 'Keep the threshold above 18.', correct: false },
      { id: 'reverse', label: 'Swap the adult and minor return values', description: 'Keep the same condition.', correct: false },
    ],
    fixtureCases: [{ input: 'age_group(17)', expected: 'minor' }, { input: 'age_group(18)', expected: 'adult' }, { input: 'age_group(21)', expected: 'adult' }],
  },
  {
    id: 'inclusive-sum-loop', category: 'off-by-one', categoryLabel: 'Off-by-one error',
    title: 'The missing last number',
    description: 'This loop should add every integer from 1 through n, but the final value is omitted.',
    objective: 'Include the upper endpoint in the range.',
    buggyCode: 'def sum_to(n):\n    total = 0\n    for value in range(1, n):\n        total += value\n    return total',
    hints: ['For n=4, which values does range(1, n) include?', 'Python’s range stop value is excluded.', 'An inclusive 1..n loop stops at n + 1.'],
    fixes: [
      { id: 'inclusive-range', label: 'Use range(1, n + 1)', description: 'Move the exclusive stop one step past n.', correct: true },
      { id: 'start-zero', label: 'Use range(0, n)', description: 'Include zero instead of n.', correct: false },
      { id: 'add-after', label: 'Keep the loop and add 1 to the total', description: 'Add a constant after summing.', correct: false },
    ],
    fixtureCases: [{ input: 'sum_to(1)', expected: '1' }, { input: 'sum_to(4)', expected: '10' }, { input: 'sum_to(0)', expected: '0' }],
  },
  {
    id: 'prime-return-value', category: 'incorrect-return', categoryLabel: 'Incorrect return value',
    title: 'A factor was found',
    description: 'The function finds a divisor, but its return value says the number is prime.',
    objective: 'Return the value that matches the meaning of finding a divisor.',
    buggyCode: 'if number % divisor == 0:\n    return True  # bug: a factor means composite',
    hints: ['Trace the input 9 when divisor is 3.', 'A zero remainder means a factor was found.', 'A composite number should return False.'],
    fixes: [
      { id: 'return-false', label: 'Return False in the divisor branch', description: 'A found factor means the number is not prime.', correct: true },
      { id: 'return-none', label: 'Remove the return from the branch', description: 'Fall through to the end of the function.', correct: false },
      { id: 'return-true', label: 'Keep returning True', description: 'Treat every divisible value as prime.', correct: false },
    ],
    fixtureCases: [{ input: 'is_prime(9)', expected: 'False' }, { input: 'is_prime(17)', expected: 'True' }],
  },
  {
    id: 'factorial-zero-case', category: 'edge-case', categoryLabel: 'Edge-case handling',
    title: 'The empty product',
    description: 'The loop does not run for zero, leaving the accumulator at 0 instead of factorial(0) = 1.',
    objective: 'Initialize the product so the zero-input case is correct.',
    buggyCode: 'def factorial(n):\n    result = 0\n    for value in range(1, n + 1):\n        result *= value\n    return result',
    hints: ['For n=0 the loop body runs zero times.', 'What value should multiplication start from?', 'Multiplying no factors is represented by 1.'],
    fixes: [
      { id: 'identity-one', label: 'Initialize result to 1', description: 'Use the multiplicative identity.', correct: true },
      { id: 'special-one', label: 'Return 0 when n is 0', description: 'Keep zero factorial equal to zero.', correct: false },
      { id: 'loop-negative', label: 'Loop from 0 through n', description: 'Multiply by zero on the first iteration.', correct: false },
    ],
    fixtureCases: [{ input: 'factorial(0)', expected: '1' }, { input: 'factorial(1)', expected: '1' }, { input: 'factorial(4)', expected: '24' }],
  },
]

export function calculateDebugResult(
  challenge: BugChallenge,
  selectedCategory: BugCategory | '',
  selectedFixId: string,
  proposedFix: string,
): DebugResult {
  const categoryIdentified = selectedCategory === challenge.category
  const fixSelected = challenge.fixes.some((fix) => fix.id === selectedFixId && fix.correct)
  const fixtureCasesPassed = fixSelected ? challenge.fixtureCases.length : 0
  const score = (categoryIdentified ? 30 : 0) + (fixSelected ? 30 : 0) +
    (challenge.fixtureCases.length ? Math.round(40 * fixtureCasesPassed / challenge.fixtureCases.length) : 0)
  const hasProposal = proposedFix.trim().length > 0
  const complete = categoryIdentified && fixSelected && fixtureCasesPassed === challenge.fixtureCases.length && hasProposal

  let feedback: string
  if (complete) {
    feedback = `Correct diagnosis and repair strategy. All ${fixtureCasesPassed} known reference cases are associated with that repair. Your written patch was not run or independently verified.`
  } else if (!hasProposal) {
    feedback = 'Write your proposed fix before submitting. The selection score is only a diagnostic preview.'
  } else if (!categoryIdentified && !fixSelected) {
    feedback = `Revisit the ${challenge.categoryLabel.toLowerCase()} and trace the boundary example in the hints.`
  } else if (!fixSelected) {
    feedback = `You identified the ${challenge.categoryLabel.toLowerCase()}, but that repair strategy does not satisfy the reference cases.`
  } else {
    feedback = 'The repair strategy matches the reference cases. Recheck the bug category you selected.'
  }
  return { categoryIdentified, fixSelected, fixtureCasesPassed,
    fixtureCasesTotal: challenge.fixtureCases.length, score, complete, feedback }
}
