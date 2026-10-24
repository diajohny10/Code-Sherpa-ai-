export type PrimeSampleCase = {
  input: string
  expected: string
}

export type LearningPlan = {
  id: 'prime' | 'fizzbuzz' | 'factorial' | 'palindrome' | 'reverse' | 'parity' | 'armstrong' | 'custom'
  title: string
  requirements: string[]
  sampleCases: PrimeSampleCase[]
  hints: string[]
  note: string
}

export type ReviewCheck = {
  id: string
  label: string
  passed: boolean
  guidance: string
}

export type ExplanationFeedback = {
  tone: 'positive' | 'encouraging'
  message: string
}

export const initialPrimePrompt =
  'Write a function that returns True if a number is prime, and False otherwise.'

export const starterPrimeCode = `def is_prime(number):
    if number < 2:
        return False

    for divisor in range(2, number):
        if number % divisor == 0:
            return True  # Can you spot the bug?

    return True


print(is_prime(9))`

export const primeHints = [
  'Follow the path for 9: which divisor does the loop find first?',
  'When number % divisor is 0, the number has a factor besides 1 and itself.',
  'The function returns True in the “found a factor” branch. What should that return be?',
]

export const primeSampleCases: PrimeSampleCase[] = [
  { input: 'is_prime(2)', expected: 'True' },
  { input: 'is_prime(3)', expected: 'True' },
  { input: 'is_prime(4)', expected: 'False' },
  { input: 'is_prime(9)', expected: 'False' },
  { input: 'is_prime(17)', expected: 'True' },
  { input: 'is_prime(-1)', expected: 'False' },
  { input: 'is_prime(-7)', expected: 'False' },
]

const primeRequirements = [
  'Reject numbers below 2',
  'Return False when a divisor is found',
  'Check candidate divisors starting at 2',
  'Return True when no divisor is found (including 2)',
]

const ruleBasedNote = 'Built from local rules · not AI-generated'

function addExplicitPromptConditions(plan: LearningPlan, prompt: string): LearningPlan {
  const conditions = prompt
    .split(/[,;]|\band\b/i)
    .map((clause) => clause.trim())
    .filter((clause) => /\b(?:must|should|when|unless|handle)\b/i.test(clause))
    .map((clause) => `Prompt constraint: ${clause}`)
  return {
    ...plan,
    requirements: [...new Set([...plan.requirements, ...conditions])].slice(0, 12),
  }
}

/** Build a local, rule-based learning plan. This never calls an AI service. */
export function buildLearningPlan(prompt: string): LearningPlan {
  const text = prompt.trim().replace(/\s+/g, ' ')
  const lower = text.toLowerCase()

  if (/\barmstrong\b/.test(lower)) {
    return addExplicitPromptConditions({
      id: 'armstrong',
      title: 'Armstrong number checker',
      requirements: [
        'Count the digits in the non-negative integer',
        'Raise each digit to the number of digits and add the results',
        'Return True when the sum equals the original number',
        'Treat negative integers as not Armstrong numbers',
      ],
      sampleCases: [
        { input: 'is_armstrong(0)', expected: 'True' },
        { input: 'is_armstrong(5)', expected: 'True' },
        { input: 'is_armstrong(153)', expected: 'True' },
        { input: 'is_armstrong(9474)', expected: 'True' },
        { input: 'is_armstrong(123)', expected: 'False' },
        { input: 'is_armstrong(-153)', expected: 'False' },
      ],
      hints: [
        'For 153, split the digits 1, 5, and 3; there are three digits.',
        'Raise each digit to that digit count, then add: 1³ + 5³ + 3³.',
        'Compare the sum with the original number; decide explicitly how to handle negatives.',
      ],
      note: `${ruleBasedNote} · cases are reference suggestions, not code execution`,
    }, text)
  }

  if (/\bprime\b/.test(lower)) {
    return addExplicitPromptConditions({
      id: 'prime',
      title: 'Prime number checker',
      requirements: primeRequirements,
      sampleCases: primeSampleCases,
      hints: primeHints,
      note: ruleBasedNote,
    }, text)
  }
  if (/\bfizzbuzz\b/.test(lower)) {
    return addExplicitPromptConditions({
      id: 'fizzbuzz',
      title: 'FizzBuzz',
      requirements: [
        'Use the divisibility rules stated in the prompt',
        'Check the combined 3-and-5 case before the individual cases',
        'Return the number itself when no rule matches',
        'Include ordinary and boundary examples',
      ],
      sampleCases: [
        { input: 'fizzbuzz(1)', expected: '1' },
        { input: 'fizzbuzz(3)', expected: 'Fizz' },
        { input: 'fizzbuzz(5)', expected: 'Buzz' },
        { input: 'fizzbuzz(15)', expected: 'FizzBuzz' },
      ],
      hints: [
        'Which input matches more than one divisibility rule?',
        'Check the combined case before checking 3 or 5 on their own.',
        'What should happen when none of the divisibility rules match?',
      ],
      note: ruleBasedNote,
    }, text)
  }
  if (/\bfactorial\b/.test(lower)) {
    return addExplicitPromptConditions({
      id: 'factorial',
      title: 'Factorial',
      requirements: [
        'Multiply the positive whole numbers up to the input',
        'Return 1 for an input of 0',
        'Return 1 for an input of 1',
        'Decide and document how negative inputs should behave',
      ],
      sampleCases: [
        { input: 'factorial(0)', expected: '1' },
        { input: 'factorial(1)', expected: '1' },
        { input: 'factorial(5)', expected: '120' },
        { input: 'factorial(-1)', expected: 'Define invalid-input behavior' },
      ],
      hints: [
        'What should the smallest valid input return?',
        'A loop can multiply each whole number from 1 through the input.',
        'Handle 0 and negative inputs separately from the multiplication loop.',
      ],
      note: ruleBasedNote,
    }, text)
  }
  if (/\bpalindrome\b/.test(lower)) {
    return addExplicitPromptConditions({
      id: 'palindrome',
      title: 'Palindrome checker',
      requirements: [
        'Compare the input with its reverse',
        'Return or print a consistent palindrome/non-palindrome result',
        'Decide whether comparison should ignore capitalization or spaces',
        'Check empty, one-character, matching, and non-matching examples',
      ],
      sampleCases: [
        { input: 'is_palindrome("")', expected: 'Confirm empty-string rule' },
        { input: 'is_palindrome("a")', expected: 'True' },
        { input: 'is_palindrome("racecar")', expected: 'True' },
        { input: 'is_palindrome("hello")', expected: 'False' },
      ],
      hints: [
        'What would the input look like if you read it from right to left?',
        'A palindrome matches its reverse under the rules you choose.',
        'Decide whether spaces and capitalization matter before comparing.',
      ],
      note: ruleBasedNote,
    }, text)
  }
  if (/\breverse\b/.test(lower) && /\bstring\b/.test(lower)) {
    return addExplicitPromptConditions({
      id: 'reverse',
      title: 'Reverse a string',
      requirements: [
        'Return the characters in reverse order',
        'Preserve each character exactly once',
        'Handle empty and one-character strings',
        'Keep the output type consistent with the prompt',
      ],
      sampleCases: [
        { input: 'reverse_string("")', expected: '""' },
        { input: 'reverse_string("a")', expected: '"a"' },
        { input: 'reverse_string("sherpa")', expected: '"aprehs"' },
      ],
      hints: [
        'Which character should appear first in the result?',
        'Think about moving from the last index back to the first.',
        'Check that the empty string stays empty.',
      ],
      note: ruleBasedNote,
    }, text)
  }
  if (/\beven\b|\bodd\b/.test(lower)) {
    const evenQuestion = /\beven\b/.test(lower) && !/\bodd\b/.test(lower)
    const name = evenQuestion ? 'is_even' : 'is_odd'
    const parityExpected = (number: number) => String(evenQuestion ? number % 2 === 0 : Math.abs(number % 2) === 1)
    return addExplicitPromptConditions({
      id: 'parity',
      title: evenQuestion ? 'Even number checker' : 'Even and odd checker',
      requirements: [
        'Use the remainder after division by 2 to classify the number',
        'Return a consistent Boolean result',
        'Handle zero and negative values',
        'Include both even and odd examples',
      ],
      sampleCases: [-4, -3, 0, 2, 3].map((number) => ({
        input: `${name}(${number})`,
        expected: parityExpected(number),
      })),
      hints: [
        'What remainder do even numbers leave when divided by 2?',
        'The % operator gives you that remainder.',
        'Check zero and negative examples against the same rule.',
      ],
      note: ruleBasedNote,
    }, text)
  }

  const titleSource = text
    .split(/[.!?]/, 1)[0]
    .replace(/^(please\s+)?(write|create|build|make|implement)\s+(?:a|an)\s+(?:python\s+)?(?:function|program|script|solution)\s+(?:that|to)\s+/i, '')
    .trim()
  const readableTitle = titleSource.length > 54
    ? `${titleSource.slice(0, 51).replace(/\s+\S*$/, '')}…`
    : titleSource
  const title = readableTitle
    ? `${readableTitle[0].toUpperCase()}${readableTitle.slice(1)}`
    : 'Custom Python challenge'
  const clauses = [...text.matchAll(/\b(?:if|when|unless|handle|return)\b[^,.;]*/gi)]
    .map((match) => match[0].trim())
    .filter((clause, index, all) => all.indexOf(clause) === index)
    .slice(0, 3)
  const exampleNumbers = [...new Set(text.match(/-?\b\d+\b/g) ?? [])].slice(0, 3)
  const customCases: PrimeSampleCase[] = [{
    input: 'Typical input from prompt',
    expected: 'Confirm from prompt',
  }, ...exampleNumbers.map((number) => ({
    input: `Prompt example: ${number}`,
    expected: 'Confirm from prompt',
  }))]
  customCases.push(
    { input: 'Boundary input', expected: 'Define expected behavior' },
    { input: 'Empty or invalid input', expected: 'Decide whether this applies' },
  )

  return {
    id: 'custom',
    title,
    requirements: [
      `Goal from prompt: ${text || 'Describe the task you want to solve.'}`,
      ...clauses.map((clause) => `Prompt condition: ${clause}`),
      'Make the input and expected output explicit',
      'Include a typical case and at least one boundary case',
    ],
    sampleCases: customCases,
    hints: [
      'Underline the input, expected output, and each condition in your prompt.',
      'Turn each condition into one small decision your code can make.',
      'Try an ordinary input, a boundary input, and an invalid input if relevant.',
    ],
    note: `${ruleBasedNote} · expected outputs need your confirmation`,
  }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Checks a few recognizable Python control-flow patterns as plain text.
 * This is deliberately not an interpreter and never runs learner source.
 */
export function reviewPrimeSource(source: string): ReviewCheck[] {
  const normalized = source.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const rejectsSmallValues = /\bif\s+[A-Za-z_]\w*\s*(?:<\s*2|<=\s*1)\s*:\s*(?:#[^\n]*)?\n\s*return\s+False\b/.test(normalized)

  const loop = normalized.match(
    /^([ \t]*)for\s+([A-Za-z_]\w*)\s+in\s+range\(\s*2\s*,\s*([A-Za-z_]\w*)(?:\s*\*\*\s*0?\.5)?\s*\)\s*:/m,
  )

  let checksDivisibility = false
  let returnsTrueAfterLoop = false
  if (loop && typeof loop.index === 'number') {
    const divisor = escapeRegExp(loop[2])
    const number = escapeRegExp(loop[3])
    const loopBody = normalized.slice(loop.index + loop[0].length)
    checksDivisibility = new RegExp(
      `\\bif\\s+${number}\\s*%\\s*${divisor}\\s*==\\s*0\\s*:\\s*(?:#[^\\n]*)?\\n\\s*return\\s+False\\b`,
    ).test(loopBody)

    const loopIndent = loop[1].length
    const loopLine = normalized.slice(0, loop.index).split('\n').length - 1
    returnsTrueAfterLoop = lines.slice(loopLine + 1).some((line) =>
      line.trim() === 'return True' && (line.match(/^[ \t]*/)?.[0].length ?? -1) === loopIndent,
    )
  }

  return [
    {
      id: 'small-values',
      label: 'Reject numbers below 2',
      passed: rejectsSmallValues,
      guidance: 'Add an early return False for values less than 2.',
    },
    {
      id: 'divisor-result',
      label: 'Return False when a divisor is found',
      passed: checksDivisibility,
      guidance: 'Inside the divisible branch, return False because the number is not prime.',
    },
    {
      id: 'divisor-loop',
      label: 'Check candidate divisors starting at 2',
      passed: Boolean(loop),
      guidance: 'Loop through possible divisors beginning at 2.',
    },
    {
      id: 'prime-result',
      label: 'Return True when no divisor is found (including 2)',
      passed: returnsTrueAfterLoop,
      guidance: 'After the loop, return True; this also handles 2, whose loop is empty.',
    },
  ]
}

export function getExplanationFeedback(answer: string): ExplanationFeedback {
  const text = answer.toLowerCase()
  const describesZeroRemainder =
    /%/.test(text) || /\b(modulo|remainder)\b/.test(text)
  const namesDivisor = /\b(divisor|factor|divisible|multiple)\b/.test(text)
  const saysZero = /\bzero\b|==\s*0|equals?\s+0\b/.test(text)
  const saysFalse = /\bfalse\b/.test(text)
  const saysNotPrime = /\bnot prime\b|\bcomposite\b/.test(text)

  if (describesZeroRemainder && saysZero && namesDivisor && saysFalse && saysNotPrime) {
    return {
      tone: 'positive',
      message:
        'That’s the key idea: a zero remainder means a divisor was found, so the number is not prime and the function should return False.',
    }
  }
  if (describesZeroRemainder && saysZero) {
    return {
      tone: 'encouraging',
      message:
        'You spotted what a zero remainder means. Complete the explanation: because a divisor was found, the number is not prime, so the function should return False.',
    }
  }
  if (saysFalse) {
    return {
      tone: 'encouraging',
      message:
        'You identified the return value. Now connect it to the check: what does a zero remainder from number % divisor tell us?',
    }
  }
  return {
    tone: 'encouraging',
    message:
      'Start with number % divisor: when the remainder is zero, a divisor was found. What should the function return in that case?',
  }
}
