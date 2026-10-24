import { buildLearningPlan, type LearningPlan } from './primeWorkflow.ts'

export type ProviderMode = 'deterministic-demo' | 'openai'

type PlanResponse = {
  mode: ProviderMode
  ai_unavailable?: boolean
  results_are_suggestions: true
  code_execution: 'disabled'
  source_used_for_suggestions?: boolean
  title: string
  requirements: string[]
  test_cases: { input: string; expected: string; category: string }[]
  hints: string[]
}

type HintsResponse = {
  mode: ProviderMode
  ai_unavailable?: boolean
  reveal_policy: 'one-at-a-time'
  code_execution: 'disabled'
  hints: string[]
}

export type MentorInput = {
  prompt: string
  requirements: string[]
  test_results: string[]
  challenge: string
  learner_text: string
  question: string
  use_ai: boolean
}
export type MentorResponse = {
  mode: ProviderMode
  ai_unavailable: boolean
  code_execution: 'disabled'
  message: string
  guiding_question: string
  hints: string[]
}

export class LearningApiError extends Error {
  readonly code: 'service' | 'aborted' | 'timeout'
  constructor(message: string, code: 'service' | 'aborted' | 'timeout' = 'service') {
    super(message)
    this.name = 'LearningApiError'
    this.code = code
  }
}

export type RequestOptions = { signal?: AbortSignal; timeoutMs?: number }
export const isRequestCancelled = (error: unknown) => error instanceof LearningApiError && error.code === 'aborted'

async function postJson(path: string, body: unknown, fetcher: typeof fetch, options: RequestOptions, method: 'POST' | 'GET' = 'POST'): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectCancellation: (error: LearningApiError) => void = () => {}
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject })
  const cancel = () => {
    rejectCancellation(new LearningApiError('Request cancelled.', 'aborted'))
    controller.abort()
  }
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  timer = setTimeout(() => {
    rejectCancellation(new LearningApiError('Learning service request timed out.', 'timeout'))
    controller.abort()
  }, options.timeoutMs ?? 30_000)
  try {
    return await Promise.race([
      cancellation,
      (async () => {
        if (controller.signal.aborted) throw new LearningApiError('Request cancelled.', 'aborted')
        const response = await fetcher(path, {
          method, credentials: 'same-origin', signal: controller.signal,
          ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        })
        return readJson(response)
      })(),
    ])
  } catch (error) {
    if (error instanceof LearningApiError) throw error
    throw new LearningApiError('Could not reach the learning service. Check that the backend is running.')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validMode(value: unknown): value is ProviderMode {
  return value === 'deterministic-demo' || value === 'openai'
}

function validStrings(value: unknown, minimum: number, maximum: number): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new LearningApiError(`Learning service returned ${response.status}.`)
  try {
    return await response.json()
  } catch {
    throw new LearningApiError('Learning service returned invalid JSON.')
  }
}

export async function requestLearningPlan(prompt: string, fetcher: typeof fetch = fetch, useAi = false, options: RequestOptions = {}): Promise<PlanResponse> {
  let payload: unknown
  try {
    payload = await postJson('/api/learning/plan', { prompt, use_ai: useAi }, fetcher, options)
  } catch (error) {
    if (error instanceof LearningApiError) throw error
    throw new LearningApiError('Could not reach the learning service. Check that the backend is running.')
  }
  return validatePlanResponse(payload)
}

function validatePlanResponse(payload: unknown): PlanResponse {
  if (!isRecord(payload) || !validMode(payload.mode) || payload.results_are_suggestions !== true ||
      (payload.ai_unavailable !== undefined && typeof payload.ai_unavailable !== 'boolean') ||
      (payload.source_used_for_suggestions !== undefined && typeof payload.source_used_for_suggestions !== 'boolean') ||
      payload.code_execution !== 'disabled' || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 120 ||
      !validStrings(payload.requirements, 2, 12) || payload.requirements.some((item) => item.length > 500) ||
      !validStrings(payload.hints, 1, 5) || payload.hints.some((hint) => hint.length > 300) ||
      !Array.isArray(payload.test_cases) || payload.test_cases.length < 2 || payload.test_cases.length > 12 ||
      !payload.test_cases.every((item) => isRecord(item) &&
        typeof item.input === 'string' && item.input.trim().length > 0 && item.input.length <= 300 &&
        typeof item.expected === 'string' && item.expected.trim().length > 0 && item.expected.length <= 300 &&
        ['ordinary', 'boundary', 'invalid', 'edge'].includes(String(item.category)))) {
    throw new LearningApiError('Learning service returned data outside the expected plan format.')
  }
  return payload as PlanResponse
}

export async function requestTestCases(prompt: string, source = '', fetcher: typeof fetch = fetch, useAi = false, options: RequestOptions = {}): Promise<PlanResponse> {
  if (useAi && source.length > 20_000) throw new LearningApiError('Editor code must contain at most 20000 characters.')
  const payload = await postJson('/api/learning/test-cases', {
    prompt, use_ai: useAi, ...(useAi && source ? { source } : {}),
  }, fetcher, options)
  return validatePlanResponse(payload)
}

export type AIStatus = {
  provider: 'openai'; configured: boolean; enabled: boolean; available: boolean;
  model: string; code_execution: 'disabled'
}

export async function requestAIStatus(fetcher: typeof fetch = fetch, options: RequestOptions = {}): Promise<AIStatus> {
  const payload = await postJson('/api/ai/status', undefined, fetcher, options, 'GET')
  if (!isRecord(payload) || payload.provider !== 'openai' || payload.code_execution !== 'disabled' ||
      typeof payload.configured !== 'boolean' || typeof payload.enabled !== 'boolean' ||
      typeof payload.available !== 'boolean' || payload.available !== (payload.configured && payload.enabled) ||
      typeof payload.model !== 'string' || !payload.model || payload.model.length > 100) {
    throw new LearningApiError('Learning service returned invalid AI configuration status.')
  }
  return { provider: 'openai', configured: payload.configured, enabled: payload.enabled,
    available: payload.available, model: payload.model, code_execution: 'disabled' }
}

export async function requestProgressiveHints(
  prompt: string,
  requirements: string[],
  fetcher: typeof fetch = fetch,
  useAi = false,
  options: RequestOptions = {},
): Promise<HintsResponse> {
  let payload: unknown
  try {
    payload = await postJson('/api/learning/hints', { prompt, requirements, use_ai: useAi }, fetcher, options)
  } catch (error) {
    if (error instanceof LearningApiError) throw error
    throw new LearningApiError('Could not reach the learning service. Check that the backend is running.')
  }
  if (!isRecord(payload) || !validMode(payload.mode) || payload.reveal_policy !== 'one-at-a-time' ||
      (payload.ai_unavailable !== undefined && typeof payload.ai_unavailable !== 'boolean') ||
      payload.code_execution !== 'disabled' || !validStrings(payload.hints, 1, 5) ||
      payload.hints.some((hint) => hint.length > 300)) {
    throw new LearningApiError('Learning service returned data outside the expected hints format.')
  }
  return payload as HintsResponse
}

export async function requestMentorReply(input: MentorInput, fetcher: typeof fetch = fetch, options: RequestOptions = {}): Promise<MentorResponse> {
  let payload: unknown
  try {
    payload = await postJson('/api/learning/mentor', input, fetcher, options)
  } catch (error) {
    if (error instanceof LearningApiError) throw error
    throw new LearningApiError('Could not reach the learning service. Check that the backend is running.')
  }
  if (!isRecord(payload) || !validMode(payload.mode) || typeof payload.ai_unavailable !== 'boolean' ||
      payload.code_execution !== 'disabled' || typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 2_000 ||
      typeof payload.guiding_question !== 'string' || !payload.guiding_question.trim() || payload.guiding_question.length > 400 ||
      !validStrings(payload.hints, 1, 5) || payload.hints.some((hint) => hint.length > 300)) {
    throw new LearningApiError('Learning service returned data outside the expected mentor format.')
  }
  return payload as MentorResponse
}

export function createDemoMentorReply(input: MentorInput): MentorResponse {
  const prompt = input.prompt.toLowerCase()
  const challenge = input.challenge.toLowerCase()
  let message: string
  let guidingQuestion: string
  let hints: string[]
  if (prompt.includes('prime') || challenge.includes('prime')) {
    message = 'For a prime check, a divisor with a zero remainder means the number has another factor. For example, 9 is divisible by 3, so it is not prime. This demo does not run submitted code.'
    guidingQuestion = 'What should the function return when number % divisor is zero?'
    hints = ['Trace 9 with divisor 2, then 3.', 'A zero remainder means a factor was found.', 'Connect that factor to the not-prime return value.']
  } else if (/\b(even|odd)\b/.test(prompt)) {
    message = 'Even and odd integers can be classified by their remainder after division by 2. Zero remainder is even; otherwise it is odd. The same check covers zero and negative integers.'
    guidingQuestion = 'What remainder do -3 and -4 leave when divided by 2?'
    hints = ['Try the remainder operator %.', 'Compare the remainder to zero.', 'Check zero and negative examples too.']
  } else if (challenge) {
    message = `This debugging challenge focuses on: ${input.challenge.slice(0, 300)}. Compare its exact boundary input with the requirement. Demo reference fixtures are not results from running your code.`
    guidingQuestion = 'Which input most clearly distinguishes the bug from the requirement?'
    hints = ['Find a boundary input.', 'Trace it through the shown condition.', 'Compare the outcome to the requirement.']
  } else if (input.test_results.length) {
    message = 'These are static or deterministic demo results, not execution of your Python. Compare each expected value with its requirement.'
    guidingQuestion = 'Which requirement has the most relevant example case?'
    hints = ['Choose one requirement.', 'Find its example input.', 'Ask which edge case remains untested.']
  } else if (input.learner_text) {
    message = `You wrote: “${input.learner_text.slice(0, 220)}”. Check whether your explanation connects the input condition to the output. This demo does not make a full correctness judgment.`
    guidingQuestion = 'What test example supports your explanation?'
    hints = ['Name the condition.', 'Describe what it means.', 'Connect it to the returned result.']
  } else {
    message = 'Break the task into its input, expected output, and one boundary case. This deterministic demo mentor does not execute code.'
    guidingQuestion = 'Which requirement would you like to reason through first?'
    hints = ['Underline the input.', 'State the expected output.', 'Try a boundary example.']
  }
  return { mode: 'deterministic-demo', ai_unavailable: input.use_ai,
    code_execution: 'disabled', message, guiding_question: guidingQuestion, hints }
}

export function planFromBackend(prompt: string, response: PlanResponse): LearningPlan {
  const local = buildLearningPlan(prompt)
  const localShape = local.id
  if (response.mode === 'deterministic-demo' && localShape !== 'custom' &&
      response.test_cases.every((item) => /^(confirm|define|decide)\b/i.test(item.expected.trim()))) {
    return { ...local, note: 'Demo-generated local reference suggestions · code not run' }
  }
  return {
    id: localShape,
    title: response.title,
    requirements: response.requirements,
    sampleCases: response.test_cases.map(({ input, expected }) => ({
      input: localShape === 'prime' && /^-?\d+$/.test(input) ? `is_prime(${input})` : input,
      expected,
    })),
    hints: response.hints,
    note: response.mode === 'openai' ? 'AI-generated suggestions · code not run' : 'Demo-generated · code not run',
  }
}
