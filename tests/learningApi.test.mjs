import assert from 'node:assert/strict'
import test from 'node:test'
import { LearningApiError, createDemoMentorReply, planFromBackend, requestAIStatus, requestTestCases, requestLearningPlan, requestProgressiveHints, requestMentorReply } from '../src/learningApi.ts'

const planResponse = {
  mode: 'deterministic-demo', results_are_suggestions: true, code_execution: 'disabled',
  title: 'Prime number checker', requirements: ['Reject values below 2', 'Return False for factors'],
  test_cases: [
    { input: '2', expected: 'True', category: 'boundary' },
    { input: '-1', expected: 'False', category: 'invalid' },
  ], hints: ['Start with 2.', 'Check factors.'],
}

test('test-case requests never transmit source when AI is off', async () => {
  let sent
  const fetcher = async (path, init) => {
    assert.equal(path, '/api/learning/test-cases')
    sent = JSON.parse(init.body)
    return new Response(JSON.stringify(planResponse))
  }
  await requestTestCases('prime', 'private editor source', fetcher, false)
  assert.deepEqual(sent, { prompt: 'prime', use_ai: false })
})

test('test-case requests transmit optional source only with explicit AI opt-in', async () => {
  let sent
  const source = 'n = int(input())\nprint(n)'
  const response = await requestTestCases('Armstrong', source, async (_path, init) => {
    sent = JSON.parse(init.body)
    assert.equal(init.credentials, 'same-origin')
    return new Response(JSON.stringify({ ...planResponse, mode: 'openai', source_used_for_suggestions: true }))
  }, true)
  assert.deepEqual(sent, { prompt: 'Armstrong', use_ai: true, source })
  assert.equal(response.source_used_for_suggestions, true)
  assert.equal(response.code_execution, 'disabled')
})

test('test-case requests reject oversized source before fetch and reject malformed responses', async () => {
  let called = false
  await assert.rejects(requestTestCases('task', 'x'.repeat(20_001), async () => {
    called = true
  }, true), /20000/)
  assert.equal(called, false)
  await assert.rejects(requestTestCases('task', '', async () => new Response(JSON.stringify({
    ...planResponse, source_used_for_suggestions: 'yes',
  })), true), /expected plan format/)
})

test('AI configuration checks use a credential-free GET without sending prompts or code', async () => {
  const status = await requestAIStatus(async (path, init) => {
    assert.equal(path, '/api/ai/status')
    assert.equal(init.method, 'GET')
    assert.equal(init.body, undefined)
    assert.equal(init.headers, undefined)
    return new Response(JSON.stringify({ provider: 'openai', configured: true, enabled: true,
      available: true, model: 'gpt-4.1-mini', code_execution: 'disabled' }))
  })
  assert.equal(status.available, true)
  assert.equal('api_key' in status, false)
})

test('AI status validation rejects inconsistent availability', async () => {
  await assert.rejects(requestAIStatus(async () => new Response(JSON.stringify({
    provider: 'openai', configured: false, enabled: false, available: true,
    model: 'gpt-4.1-mini', code_execution: 'disabled',
  }))), /configuration status/)
})

test('generic backend demo responses do not discard concrete local Armstrong reference cases', () => {
  const generic = { ...planResponse, title: 'Custom Python challenge', test_cases: [
    { input: 'Typical input', expected: 'Confirm from prompt', category: 'ordinary' },
    { input: 'Boundary input', expected: 'Define expected behavior', category: 'boundary' },
  ] }
  const local = planFromBackend('Check an Armstrong number', generic)
  assert.equal(local.id, 'armstrong')
  assert.ok(local.sampleCases.some(item => item.input === 'is_armstrong(153)' && item.expected === 'True'))
  assert.ok(local.sampleCases.some(item => item.input === 'is_armstrong(123)' && item.expected === 'False'))
  assert.match(local.note, /local reference/)
  const ai = planFromBackend('Check an Armstrong number', { ...generic, mode: 'openai' })
  assert.deepEqual(ai.sampleCases, generic.test_cases.map(({ input, expected }) => ({ input, expected })))
  assert.match(ai.note, /AI-generated/)
})

test('frontend plan request sends prompt to backend and maps its structured response', async () => {
  let requestedUrl = ''
  let requestedBody = ''
  const fetcher = async (url, init) => {
    requestedUrl = url
    requestedBody = init.body
    return new Response(JSON.stringify(planResponse), { status: 200 })
  }
  const response = await requestLearningPlan('Write a prime checker', fetcher)
  const plan = planFromBackend('Write a prime checker', response)
  assert.equal(requestedUrl, '/api/learning/plan')
  assert.deepEqual(JSON.parse(requestedBody), { prompt: 'Write a prime checker', use_ai: false })
  assert.equal(plan.id, 'prime')
  assert.equal(plan.sampleCases[0].input, 'is_prime(2)')
  assert.match(plan.note, /Demo-generated/)
})

test('frontend preserves explicit AI-generated source labeling', async () => {
  const response = await requestLearningPlan('Task', async () => new Response(
    JSON.stringify({ ...planResponse, mode: 'openai' }), { status: 200 }))
  assert.match(planFromBackend('Task', response).note, /AI-generated/)
})

test('backend parity plan is retained as the even-odd challenge type', async () => {
  const response = await requestLearningPlan('Check if a number is even or odd', async () => new Response(
    JSON.stringify({ ...planResponse, title: 'Even and odd checker', requirements: ['Check remainder', 'Handle negatives'],
      test_cases: [{ input: '-4', expected: 'even', category: 'boundary' },
        { input: '3', expected: 'odd', category: 'ordinary' }] }), { status: 200 }))
  const plan = planFromBackend('Check if a number is even or odd', response)
  assert.equal(plan.id, 'parity')
  assert.equal(plan.sampleCases[0].input, '-4')
})

test('backend Armstrong plan retains its specific challenge type and cases', async () => {
  const response = await requestLearningPlan('Check for an Armstrong number', async () => new Response(
    JSON.stringify({ ...planResponse, title: 'Armstrong number checker',
      test_cases: [{ input: 'is_armstrong(153)', expected: 'True', category: 'ordinary' },
        { input: 'is_armstrong(123)', expected: 'False', category: 'ordinary' }] }), { status: 200 }))
  const plan = planFromBackend('Check for an Armstrong number', response)
  assert.equal(plan.id, 'armstrong')
  assert.deepEqual(plan.sampleCases, [
    { input: 'is_armstrong(153)', expected: 'True' },
    { input: 'is_armstrong(123)', expected: 'False' },
  ])
})

test('hints request goes to backend with prompt and requirements, preserving order', async () => {
  let url = ''
  let body = ''
  const hints = await requestProgressiveHints('Task', ['Requirement A'], async (path, init) => {
    url = path
    body = init.body
    return new Response(JSON.stringify({ mode: 'deterministic-demo', reveal_policy: 'one-at-a-time',
      code_execution: 'disabled', hints: ['First', 'Second'] }), { status: 200 })
  })
  assert.equal(url, '/api/learning/hints')
  assert.deepEqual(JSON.parse(body), { prompt: 'Task', requirements: ['Requirement A'], use_ai: false })
  assert.deepEqual(hints.hints, ['First', 'Second'])
})

test('mentor endpoint uses opt-in flag and returns validated demo-labeled context help', async () => {
  let requestBody
  const input = { prompt: 'prime number', requirements: ['Return False for factors'],
    test_results: ['9 expected False'], challenge: '', learner_text: 'A divisor was found',
    question: 'Why does modulo help?', use_ai: false }
  const reply = await requestMentorReply(input, async (_url, init) => {
    requestBody = JSON.parse(init.body)
    return new Response(JSON.stringify({ mode: 'deterministic-demo', ai_unavailable: false,
      code_execution: 'disabled', message: 'A zero remainder means a factor was found.',
      guiding_question: 'What should happen next?', hints: ['Trace 9.', 'Check divisor 3.'] }), { status: 200 })
  })
  assert.equal(requestBody.use_ai, false)
  assert.equal(reply.mode, 'deterministic-demo')
  assert.equal(reply.hints.length, 2)
})

test('mentor input explicitly enables AI only when requested and local fallback is context-aware', async () => {
  const input = { prompt: 'even or odd', requirements: [], test_results: [], challenge: '',
    learner_text: '', question: 'How do negative numbers work?', use_ai: true }
  let sent = false
  const reply = await requestMentorReply(input, async (_url, init) => {
    sent = JSON.parse(init.body).use_ai
    return new Response(JSON.stringify({ mode: 'deterministic-demo', ai_unavailable: true,
      code_execution: 'disabled', message: 'Demo fallback for even and odd.', guiding_question: 'What is the remainder?',
      hints: ['Use %', 'Compare to zero'] }), { status: 200 })
  })
  assert.equal(sent, true)
  assert.equal(reply.ai_unavailable, true)
  const offline = createDemoMentorReply(input)
  assert.equal(offline.mode, 'deterministic-demo')
  assert.match(offline.message, /remainder after division by 2/)
})

test('mentor provider errors and malformed responses are surfaced for local demo fallback', async () => {
  await assert.rejects(requestMentorReply({ prompt: 'prime', requirements: [], test_results: [], challenge: '',
    learner_text: '', question: 'Help?', use_ai: false }, async () => new Response('{"detail":"unavailable"}', { status: 502 })),
    (error) => error instanceof LearningApiError && /502/.test(error.message))
  await assert.rejects(requestMentorReply({ prompt: 'prime', requirements: [], test_results: [], challenge: '',
    learner_text: '', question: 'Help?', use_ai: false }, async () => new Response('{"mode":"openai"}', { status: 200 })),
    (error) => error instanceof LearningApiError && /mentor format/.test(error.message))
})

test('non-success, invalid schema, and network errors are surfaced for demo fallback', async () => {
  await assert.rejects(requestLearningPlan('Task', async () => new Response('{}', { status: 422 })),
    (error) => error instanceof LearningApiError && /422/.test(error.message))
  await assert.rejects(requestLearningPlan('Task', async () => new Response('{"mode":"openai"}', { status: 200 })),
    (error) => error instanceof LearningApiError && /expected plan format/.test(error.message))
  await assert.rejects(requestProgressiveHints('Task', [], async () => { throw new Error('offline') }),
    (error) => error instanceof LearningApiError && /backend is running/.test(error.message))
})

test('malformed test case fields are rejected instead of rendered', async () => {
  const invalid = { ...planResponse, test_cases: [{ input: '', expected: '??', category: 'unknown' }, ...planResponse.test_cases] }
  await assert.rejects(requestLearningPlan('Task', async () => new Response(JSON.stringify(invalid), { status: 200 })),
    (error) => error instanceof LearningApiError)
})

for (const [field, limit] of [['title', 120], ['requirements', 500], ['hints', 300]]) {
  for (const padded of [false, true]) {
    test(`plan rejects oversized ${field}${padded ? ' before trimming' : ''}`, async () => {
      const oversized = padded ? ` ${'x'.repeat(limit - 1)} ` : 'x'.repeat(limit + 1)
      const invalid = {
        ...planResponse,
        [field]: field === 'title' ? oversized : [...planResponse[field], oversized],
      }
      await assert.rejects(requestLearningPlan('Task', async () => new Response(JSON.stringify(invalid))),
        (error) => error instanceof LearningApiError &&
          error.message === 'Learning service returned data outside the expected plan format.')
    })
  }
}

test('plan accepts title, requirements, and hints at their exact length limits', async () => {
  const valid = { ...planResponse, title: 't'.repeat(120),
    requirements: ['r'.repeat(500), 'Another requirement'], hints: ['h'.repeat(300)] }
  const response = await requestLearningPlan('Task', async () => new Response(JSON.stringify(valid)))
  assert.deepEqual(response, valid)
})

for (const padded of [false, true]) {
  test(`progressive hints reject oversized items${padded ? ' before trimming' : ''}`, async () => {
    const invalid = { mode: 'deterministic-demo', reveal_policy: 'one-at-a-time',
      code_execution: 'disabled', hints: ['First hint', padded ? ` ${'h'.repeat(299)} ` : 'h'.repeat(301)] }
    await assert.rejects(requestProgressiveHints('Task', [], async () => new Response(JSON.stringify(invalid))),
      (error) => error instanceof LearningApiError &&
        error.message === 'Learning service returned data outside the expected hints format.')
  })
}

test('progressive hints accept items at the exact length limit', async () => {
  const valid = { mode: 'deterministic-demo', reveal_policy: 'one-at-a-time',
    code_execution: 'disabled', hints: ['h'.repeat(300)] }
  const response = await requestProgressiveHints('Task', [], async () => new Response(JSON.stringify(valid)))
  assert.deepEqual(response, valid)
})
