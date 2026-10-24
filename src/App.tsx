import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Command,
  Compass,
  FlaskConical,
  Lightbulb,
  MessageSquareText,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  XCircle,
  Award,
  Bug,
  GraduationCap,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import {
  buildLearningPlan,
  getExplanationFeedback,
  initialPrimePrompt,
  reviewPrimeSource,
  starterPrimeCode,
  type LearningPlan,
} from './primeWorkflow'
import { LearningApiError, isRequestCancelled, createDemoMentorReply, planFromBackend, requestLearningPlan, requestTestCases, requestProgressiveHints, requestMentorReply, type ProviderMode } from './learningApi'
import { AIConnectionStatus } from './AIConnectionStatus'
import { calculateRequirementCoverage } from './coverage'
import { bugCategories, bugChallenges, calculateDebugResult, type BugCategory } from './bugDetective'
import {
  ACHIEVEMENTS, getLevelProgress, recordChallengeCompletion,
  recordClearExplanation, recordCoverageResult, recordHintUsed,
} from './progress'
import { localProgressStore, useLearningProgress, type ProgressStore } from './useLearningProgress'
import { useLearningRequests } from './useLearningRequests'
import { PythonExecutionPanel } from './PythonExecutionPanel'
import { RequirementCoveragePanel } from './RequirementCoveragePanel'
import type { BrowserExecutionEvidence } from './executionEvidence'

export type AppProps = { accountKey?: string; progressStore?: ProgressStore; accountPanel?: ReactNode; progressDescription?: string }

function App({ accountKey = 'local', progressStore = localProgressStore, ...props }: AppProps) {
  return <LearningWorkspace key={accountKey} progressStore={progressStore} {...props} />
}

function LearningWorkspace({ progressStore, accountPanel, progressDescription = 'Stored in this browser only. No account sync.' }: Omit<AppProps, 'accountKey'> & { progressStore: ProgressStore }) {
  const [code, setCode] = useState(starterPrimeCode)
  const [hintLevel, setHintLevel] = useState(0)
  const [reviewed, setReviewed] = useState(false)
  const [showCases, setShowCases] = useState(false)
  const [planReady, setPlanReady] = useState(false)
  const [editorPreserved, setEditorPreserved] = useState(false)
  const [prompt, setPrompt] = useState(initialPrimePrompt)
  const [activePrompt, setActivePrompt] = useState(initialPrimePrompt)
  const [plan, setPlan] = useState<LearningPlan>(() => buildLearningPlan(initialPrimePrompt))
  const [executionEvidence, setExecutionEvidence] = useState<BrowserExecutionEvidence | null>(null)
  const [executionEpoch, setExecutionEpoch] = useState(0)
  const [explanation, setExplanation] = useState('')
  const [feedback, setFeedback] = useState<ReturnType<typeof getExplanationFeedback> | null>(null)
  const [providerMode, setProviderMode] = useState<ProviderMode>('deterministic-demo')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState('')
  const [hintsLoadedFromBackend, setHintsLoadedFromBackend] = useState(false)
  const [hintLoading, setHintLoading] = useState(false)
  const [hintError, setHintError] = useState('')
  const [hintsMode, setHintsMode] = useState<ProviderMode>('deterministic-demo')
  const [allowAi, setAllowAi] = useState(false)
  const [shareSource, setShareSource] = useState(false)
  const [sourceUsed, setSourceUsed] = useState(false)
  const [testFeedback, setTestFeedback] = useState({ message: '', sequence: 0 })
  const resultsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!testFeedback.message) return
    const target = resultsRef.current?.querySelector<HTMLElement>('.results-panel')
    if (target) target.tabIndex = -1
    target?.focus({ preventScroll: true })
    target?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }, [testFeedback])
  const { progress, updateProgress, resetProgress, storageWarning } = useLearningProgress(progressStore)
  const requests = useLearningRequests()
  const [progressNotice, setProgressNotice] = useState('')
  const [bugIndex, setBugIndex] = useState(0)
  const [bugCategory, setBugCategory] = useState<BugCategory | ''>('')
  const [bugFixId, setBugFixId] = useState('')
  const [bugFixText, setBugFixText] = useState('')
  const [bugHintLevel, setBugHintLevel] = useState(0)
  const [debugResult, setDebugResult] = useState<ReturnType<typeof calculateDebugResult> | null>(null)
  const [mentorQuestion, setMentorQuestion] = useState('')
  const [mentorReply, setMentorReply] = useState<Awaited<ReturnType<typeof requestMentorReply>> | null>(null)
  const [mentorLoading, setMentorLoading] = useState(false)
  const [mentorError, setMentorError] = useState('')
  const [mentorHintLevel, setMentorHintLevel] = useState(0)

  const requirements = plan.id === 'prime' ? reviewPrimeSource(code) : []
  const completed = requirements.filter((item) => item.passed).length
  const coverage = useMemo(() => calculateRequirementCoverage(plan.id, plan.requirements, plan.sampleCases), [plan.id, plan.requirements, plan.sampleCases])
  const executionContextKey = JSON.stringify([plan.id, activePrompt, plan.requirements, executionEpoch])
  const currentBug = bugChallenges[bugIndex]
  const levelProgress = getLevelProgress(progress.xp)

  const navigateTo = (id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    target.tabIndex = -1
    target.focus({ preventScroll: true })
    target.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  const invalidateWork = () => {
    requests.invalidate()
    setPlanLoading(false)
    setHintLoading(false)
    setMentorLoading(false)
    setMentorReply(null)
    setMentorError('')
    setMentorHintLevel(0)
  }

  const announceCases = (nextPlan: LearningPlan) => {
    const generic = nextPlan.sampleCases.every((item) => /^(confirm|define|decide)\b/i.test(item.expected.trim()))
    setTestFeedback((current) => ({
      sequence: current.sequence + 1,
      message: generic
        ? `Showing ${nextPlan.sampleCases.length} placeholder cases. This demo needs concrete inputs and outputs; submitted code was not executed.`
        : `Showing ${nextPlan.sampleCases.length} suggested cases. Submitted code was not executed.`,
    }))
  }

  const createPlan = async ({ testCases = false, preserveEditor = false } = {}) => {
    if (!prompt.trim() || planLoading) return
    invalidateWork()
    setExecutionEpoch((current) => current + 1)
    setExecutionEvidence(null)
    const signal = requests.start('plan')
    const requestedPrompt = prompt
    setPlanLoading(true)
    setPlanError('')
    setHintError('')
    let nextPlan: LearningPlan
    let nextSourceUsed = false
    try {
      const response = testCases
        ? await requestTestCases(requestedPrompt, allowAi && shareSource ? code : '', fetch, allowAi, { signal })
        : await requestLearningPlan(requestedPrompt, fetch, allowAi, { signal })
      if (signal.aborted) return
      nextPlan = planFromBackend(requestedPrompt, response)
      nextSourceUsed = testCases && allowAi && shareSource && response.source_used_for_suggestions === true
      setProviderMode(response.mode)
      setHintsMode(response.mode)
      setPlanError(response.ai_unavailable ? 'AI is unavailable: the server may have AI disabled or no backend API key configured. These results are deterministic demo output.' : '')
    } catch (error) {
      if (signal.aborted || isRequestCancelled(error)) return
      nextPlan = buildLearningPlan(requestedPrompt)
      setProviderMode('deterministic-demo')
      setHintsMode('deterministic-demo')
      setPlanError(`${error instanceof LearningApiError ? error.message : 'Learning service unavailable.'} Showing the local demo plan.`)
    }
    if (signal.aborted) return
    invalidateWork()
    const samePlanType = nextPlan.id === plan.id
    setEditorPreserved(preserveEditor || samePlanType)
    if (!preserveEditor && !samePlanType) {
      setCode(nextPlan.id === 'prime' ? starterPrimeCode : '# Add your Python solution here')
    }
    setPlan(nextPlan)
    setSourceUsed(nextSourceUsed)
    setActivePrompt(requestedPrompt)
    setPlanReady(true)
    setHintLevel(0)
    setReviewed(testCases && nextPlan.id === 'prime')
    setShowCases(true)
    announceCases(nextPlan)
    setExplanation('')
    setFeedback(null)
    setHintsLoadedFromBackend(false)
    setHintLoading(false)
    setPlanLoading(false)
    const nextCoverage = calculateRequirementCoverage(nextPlan.id, nextPlan.requirements, nextPlan.sampleCases)
    const recordedAt = new Date().toISOString()
    updateProgress((current) => recordCoverageResult(current, {
      challengeId: nextPlan.id, recordedAt, score: nextCoverage.score,
      passed: nextCoverage.passed, missing: nextCoverage.missing, untested: nextCoverage.untested,
    }))
  }

  const resetChallenge = () => {
    invalidateWork()
    setExecutionEpoch((current) => current + 1)
    setExecutionEvidence(null)
    const defaultPlan = buildLearningPlan(initialPrimePrompt)
    setCode(starterPrimeCode)
    setHintLevel(0)
    setReviewed(false)
    setShowCases(false)
    setPlanReady(false)
    setEditorPreserved(false)
    setPrompt(initialPrimePrompt)
    setActivePrompt(initialPrimePrompt)
    setPlan(defaultPlan)
    setExplanation('')
    setFeedback(null)
    setProviderMode('deterministic-demo')
    setPlanError('')
    setHintsLoadedFromBackend(false)
    setHintLoading(false)
    setHintError('')
    setHintsMode('deterministic-demo')
    setAllowAi(false)
    setShareSource(false)
    setSourceUsed(false)
    setTestFeedback({ message: '', sequence: 0 })
    setBugCategory('')
    setBugFixId('')
    setBugFixText('')
    setBugHintLevel(0)
    setDebugResult(null)
    setMentorQuestion('')
    setMentorReply(null)
    setMentorError('')
    setMentorHintLevel(0)
    setProgressNotice('')
  }

  const revealHint = async () => {
    if (hintLoading || hintLevel >= plan.hints.length) return
    if (!hintsLoadedFromBackend) {
      const signal = requests.start('hints')
      setHintLoading(true)
      setHintError('')
      try {
        const response = await requestProgressiveHints(activePrompt, plan.requirements, fetch, allowAi, { signal })
        if (signal.aborted) return
        setPlan((current) => ({ ...current, hints: response.hints }))
        setHintsMode(response.mode)
        if (response.ai_unavailable) setHintError('AI is unavailable: the server may have AI disabled or no backend API key configured. These are deterministic demo hints.')
        setHintsLoadedFromBackend(true)
        setHintLevel(1)
      } catch (error) {
        if (signal.aborted || isRequestCancelled(error)) return
        setHintsLoadedFromBackend(true)
        setHintLevel(1)
        setHintError(`${error instanceof LearningApiError ? error.message : 'Learning service unavailable.'} Revealing the hints already included with this plan.`)
      } finally {
        if (!signal.aborted) setHintLoading(false)
      }
      if (!signal.aborted) updateProgress(recordHintUsed)
      return
    }
    setHintLevel((level) => Math.min(plan.hints.length, level + 1))
    updateProgress(recordHintUsed)
  }

  const reviewCode = async () => {
    if (planLoading || !prompt.trim()) return
    const generic = plan.sampleCases.every((item) => /^(confirm|define|decide)\b/i.test(item.expected.trim()))
    if (prompt !== activePrompt || allowAi || (generic && buildLearningPlan(prompt).id !== 'custom')) {
      await createPlan({ testCases: true, preserveEditor: true })
      return
    }
    setShowCases(true)
    setReviewed(plan.id === 'prime')
    announceCases(plan)
  }

  const submitExplanation = () => {
    const nextFeedback: ReturnType<typeof getExplanationFeedback> = plan.id === 'prime'
      ? getExplanationFeedback(explanation)
      : {
          tone: 'encouraging',
          message: 'This local demo can’t assess a custom explanation. Compare your reasoning with the structured requirements above; no AI evaluated this response.',
        }
    setFeedback(nextFeedback)
    if (nextFeedback.tone === 'positive' && plan.id === 'prime') {
      updateProgress(recordClearExplanation)
      setProgressNotice('Clear explanation recorded. Repeat feedback does not award extra XP.')
    }
  }

  const submitDebugAttempt = () => {
    const result = calculateDebugResult(currentBug, bugCategory, bugFixId, bugFixText)
    setDebugResult(result)
    if (!result.complete) return
    const completedAt = new Date().toISOString()
    updateProgress((current) => recordChallengeCompletion(current, {
      challengeId: currentBug.id, kind: 'bug-detective', completedAt,
      score: result.score, hintsUsed: bugHintLevel, verifiedTestsPassed: false,
    }))
    setProgressNotice('Challenge complete. Repeat completion does not award extra XP.')
  }

  const tryNextBug = () => {
    invalidateWork()
    setBugIndex((index) => (index + 1) % bugChallenges.length)
    setBugCategory('')
    setBugFixId('')
    setBugFixText('')
    setBugHintLevel(0)
    setDebugResult(null)
  }

  const revealBugHint = () => {
    if (bugHintLevel >= currentBug.hints.length) return
    setBugHintLevel((level) => level + 1)
    updateProgress(recordHintUsed)
  }

  const revealMentorHint = () => {
    if (!mentorReply || mentorHintLevel >= mentorReply.hints.length) return
    setMentorHintLevel((level) => level + 1)
    updateProgress(recordHintUsed)
  }

  const resetLearnerProgress = () => {
    if (!window.confirm('Reset all learning progress in this workspace? This cannot be undone.')) return
    invalidateWork()
    setExecutionEpoch((current) => current + 1)
    setExecutionEvidence(null)
    resetProgress()
    setProgressNotice('Learning progress was reset.')
  }

  const askMentor = async () => {
    if (!mentorQuestion.trim() || mentorLoading) return
    const signal = requests.start('mentor')
    setMentorLoading(true)
    setMentorError('')
    setMentorReply(null)
    setMentorHintLevel(0)
    try {
      const reply = await requestMentorReply({
        prompt: activePrompt, requirements: plan.requirements,
        test_results: coverage.requirements.map((item) => `${item.status}: ${item.requirement}`),
        challenge: `${currentBug.title}: ${currentBug.description}`,
        learner_text: [explanation, bugFixText].filter(Boolean).join('\n').slice(0, 2_000),
        question: mentorQuestion.trim(), use_ai: allowAi,
      }, fetch, { signal })
      if (signal.aborted) return
      setMentorReply(reply)
      if (reply.ai_unavailable) setMentorError('AI is unavailable: the server may have AI disabled or no backend API key configured. This reply is deterministic demo output.')
    } catch (error) {
      if (signal.aborted || isRequestCancelled(error)) return
      setMentorReply(createDemoMentorReply({
        prompt: activePrompt, requirements: plan.requirements,
        test_results: coverage.requirements.map((item) => `${item.status}: ${item.requirement}`),
        challenge: `${currentBug.title}: ${currentBug.description}`,
        learner_text: [explanation, bugFixText].filter(Boolean).join('\n').slice(0, 2_000),
        question: mentorQuestion.trim(), use_ai: allowAi,
      }))
      setMentorError(`${error instanceof LearningApiError ? error.message : 'Mentor service is unavailable.'} Showing deterministic local demo guidance.`)
    } finally {
      if (!signal.aborted) setMentorLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Code Sherpa AI home"><span className="brand-mark"><Compass size={19} strokeWidth={2.2} /></span><span>code sherpa<span className="brand-ai">.ai</span></span></a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <button className="nav-item active" onClick={() => navigateTo('top')}><span className="nav-icon"><Activity size={17} /></span>Learning path<span className="nav-current" /></button>
        <button className="nav-item" onClick={() => navigateTo('progress')}><span className="nav-icon"><BookOpen size={17} /></span>My concepts</button>
        <button className="nav-item" onClick={() => navigateTo('bug-detective')}><span className="nav-icon"><Terminal size={17} /></span>Practice lab</button>
        <div className="sidebar-divider" />
        <div className="workspace-label">CURRENT CHALLENGE</div>
        <button className="challenge-link selected" onClick={() => navigateTo('workspace')}><span className="challenge-dot green" />{plan.title}</button>
        <div className="sidebar-spacer" />
        <a className="profile" href="#account-panel" aria-label={accountPanel ? 'Learner account' : 'Local learner'} title={accountPanel ? 'Learner account' : 'Local learner'}><span className="profile-icon" aria-hidden="true"><UserRound size={18} /></span><span className="profile-copy"><strong>{accountPanel ? 'Learner account' : 'Local learner'}</strong><small>{levelProgress.current}</small></span></a>
      </aside>

      <main className="main" id="top">
        <header className="topbar"><div className="breadcrumbs"><span>Learning path</span><ChevronRight size={14} /><strong>Python fundamentals</strong></div><div className="topbar-right"><span className="demo-pill"><i />{providerMode === 'openai' ? 'AI-GENERATED SUGGESTIONS' : 'DEMO-GENERATED SUGGESTIONS'}</span></div></header>
        <div className="content">
          {accountPanel ?? <section id="account-panel" aria-label="Account"><p>Guest learner. Progress stays in this browser.</p></section>}
            {progressNotice && <div className="achievement-toast" role="status" aria-live="polite"><Award size={15} /><span>{progressNotice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setProgressNotice('')}><XCircle size={15} /></button></div>}
          <section className="challenge-hero" aria-labelledby="challenge-title">
            <div className="summit-art" aria-hidden="true">
              <svg viewBox="0 0 640 360" fill="none" focusable="false">
                <defs>
                  <linearGradient id="summit-back" x1="320" y1="95" x2="320" y2="360" gradientUnits="userSpaceOnUse"><stop stopColor="#7163b8" /><stop offset="1" stopColor="#171925" /></linearGradient>
                  <linearGradient id="summit-front" x1="380" y1="160" x2="380" y2="360" gradientUnits="userSpaceOnUse"><stop stopColor="#38394e" /><stop offset="1" stopColor="#10131c" /></linearGradient>
                  <radialGradient id="summit-glow"><stop stopColor="#a995ef" stopOpacity=".28" /><stop offset="1" stopColor="#a995ef" stopOpacity="0" /></radialGradient>
                </defs>
                <circle cx="386" cy="125" r="145" fill="url(#summit-glow)" />
                <circle cx="386" cy="125" r="66" stroke="#bcb0ef" strokeOpacity=".2" />
                <circle cx="386" cy="125" r="99" stroke="#bcb0ef" strokeOpacity=".1" strokeDasharray="3 8" />
                <circle cx="386" cy="125" r="37" fill="#d9ceff" fillOpacity=".85" />
                <path d="M0 360 185 176 261 235 363 96 580 360Z" fill="url(#summit-back)" />
                <path d="m363 96-30 115 30-27 42 29Z" fill="#d8cdfa" fillOpacity=".35" />
                <path d="m363 96 50 156-50-68Z" fill="#beb3eb" fillOpacity=".2" />
                <path d="M128 360 292 235 353 279 447 180 640 360Z" fill="url(#summit-front)" />
                <path d="m447 180-25 67 25-21 38 18Z" fill="#8d8da8" fillOpacity=".4" />
                <path d="M0 360 133 288 228 330 309 292 428 360Z" fill="#131720" />
                <path d="m292 360 53-37-14-17 27-15-5-12" stroke="#9de9ce" strokeOpacity=".65" strokeWidth="1.5" strokeDasharray="4 6" />
                <circle cx="353" cy="279" r="4" fill="#a6efd5" /><circle cx="353" cy="279" r="10" stroke="#a6efd5" strokeOpacity=".25" />
                <g fill="#ded6ff" fillOpacity=".6"><circle cx="200" cy="82" r="1.5" /><circle cx="480" cy="59" r="1" /><circle cx="541" cy="143" r="1.5" /><circle cx="292" cy="44" r="1" /><circle cx="139" cy="140" r="1" /></g>
              </svg>
              <span className="summit-caption">ONE CONCEPT. ONE STEP CLOSER.</span>
            </div>
            <div className="hero-copy">
              <div className="eyebrow"><span className="hero-beacon" /> YOUR NEXT SUMMIT <span className="eyebrow-line" /> PYTHON FUNDAMENTALS</div>
              <div className="title-row"><div><h1 id="challenge-title">Sherpa AI</h1><p className="subtitle">{plan.id === 'prime' ? 'Go beyond getting it to work. Understand why it works.' : `${providerMode === 'openai' ? 'AI-generated' : 'Demo-generated'} learning plan from your prompt.`}</p></div></div>
              <div className="hero-meta"><div className="level-badge"><Compass size={14} />{plan.id === 'prime' ? 'Beginner' : 'Your prompt'} <i />{plan.id === 'prime' ? '~8 min' : providerMode === 'openai' ? 'AI-generated' : 'Demo-generated'}</div><span className="hero-safety"><ShieldCheck size={14} /> A safe space to figure it out</span></div>
            </div>
          </section>
          <nav className="journey-nav" aria-label="Learning shortcuts">
            <button onClick={() => navigateTo('workspace')}><span className="journey-icon"><Terminal size={17} /></span><span><strong>Your workspace</strong><small>Read. Question. Understand.</small></span><ArrowDown size={15} /></button>
            <button onClick={() => navigateTo('bug-detective')}><span className="journey-icon"><Bug size={17} /></span><span><strong>Bug Detective</strong><small>Turn mistakes into discoveries.</small></span><ArrowRight size={15} /></button>
            <button onClick={() => navigateTo('mentor')}><span className="journey-icon"><Sparkles size={17} /></span><span><strong>Code Mentor</strong><small>A little guidance goes a long way.</small></span><ArrowRight size={15} /></button>
          </nav>

          <section className="prompt-card"><div className="prompt-icon"><MessageSquareText size={18} /></div><div className="prompt-body"><div className="prompt-heading">YOUR PROGRAMMING PROMPT</div><textarea aria-label="Programming prompt" maxLength={4000} value={prompt} onChange={(event) => { invalidateWork(); setPrompt(event.target.value); setPlanReady(false); setPlanError(''); setHintError('') }} rows={2} /><div className="prompt-actions"><button className="plan-button" onClick={() => { void createPlan() }} disabled={!prompt.trim() || planLoading}>{planLoading ? 'Building learning plan…' : 'Build requirements & test cases'} {!planLoading && <ArrowRight size={13} />}</button><label className="ai-opt-in"><input type="checkbox" checked={allowAi} onChange={(event) => { invalidateWork(); setAllowAi(event.target.checked); if (!event.target.checked) setShareSource(false) }} /> Allow configured AI for this request (may incur cost)</label></div>
            <label className="ai-opt-in"><input type="checkbox" checked={shareSource} disabled={!allowAi} onChange={(event) => { invalidateWork(); setShareSource(event.target.checked) }} /> Include editor code in AI test suggestions</label>
            <p className="plan-generation-note">With AI enabled, your prompt is sent to OpenAI. Editor code is sent only for test suggestions when separately opted in (maximum 20000 characters); it is not executed. Do not paste secrets.</p>
            <AIConnectionStatus />
            <p className="plan-generation-note">Active plan prompt: {activePrompt}</p>{planError && <p className="plan-generation-note" role="status">{planError}</p>}<p className="plan-generation-note" role="status">{planReady ? `Created ${plan.requirements.length} structured requirements and ${plan.sampleCases.length} suggested cases. ${plan.note}. ${editorPreserved ? 'Existing editor text was preserved.' : 'The editor is ready for this new plan type.'}` : planLoading ? 'Building learning plan.' : ''}</p></div></section>

          <div className="section-heading" id="workspace"><div><span className="section-number">01</span><h2>Make it make sense</h2><span className="section-sub">Read the code. Find what needs fixing.</span></div><button className="reset-button" onClick={resetChallenge}><RotateCcw size={14} /> Reset challenge</button></div>
          <p role="status" aria-label="Code review feedback">{reviewed ? `${completed} of ${requirements.length} fixed prime structure checks matched. Submitted code was not executed.` : ''}</p>
          <p role="status" aria-label="Test case feedback" aria-busy={planLoading}><span key={testFeedback.sequence}>{testFeedback.message}</span></p>
          {sourceUsed && <p className="plan-generation-note">Editor code shared for suggestions; not executed.</p>}
          <div className="work-grid">
            <section className="panel editor-panel"><div className="panel-header"><div className="file-name"><span className="python-mark">Py</span> {plan.id === 'prime' ? 'prime_checker.py' : 'solution.py'} <span className="unsaved-dot" /></div><div className="editor-tools"><span className="code-label">PYTHON 3</span><button className="run-button" onClick={() => { void reviewCode() }} disabled={planLoading || !prompt.trim()} title="Show suggested cases; Python is not executed"><Play size={14} fill="currentColor" />{planLoading ? 'Preparing test cases…' : allowAi ? 'Generate AI test cases' : plan.id === 'prime' && prompt === activePrompt ? 'Review my code' : 'Show test cases'}</button></div></div><div className="editor"><div className="line-numbers">{code.split('\n').map((_, index) => <div key={index}>{String(index + 1).padStart(2, '0')}</div>)}</div><textarea aria-label="Python code editor" maxLength={20000} spellCheck={false} value={code} onChange={(event) => { if (shareSource && allowAi) invalidateWork(); setCode(event.target.value); setReviewed(false) }} onKeyDown={(event) => { if (plan.id === 'prime' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void reviewCode() } }} /></div><div className="editor-footer"><span><span className="status-dot" />Static review only; use Run and test Python below for real execution</span><span>{plan.id === 'prime' ? <><Command size={12} /> Ctrl / ⌘ + Enter</> : 'Suggestions are not execution results'}</span></div></section>

            <div className="right-stack" ref={resultsRef}>
              <RequirementCoveragePanel requirements={plan.requirements} source={code} contextKey={executionContextKey} evidence={executionEvidence} referenceReport={coverage} />

              <section className={`panel results-panel ${showCases ? 'results-open' : ''}`}><div className="panel-heading"><div className="mini-icon amber"><FlaskConical size={15} /></div><div><h3>{plan.id === 'prime' ? 'Prime test suggestions' : 'Suggested test cases'}</h3><p>{providerMode === 'openai' ? 'AI-generated expected values · not executed' : 'Demo-generated expected values · not executed'}</p></div><span className="test-count">{plan.sampleCases.length} examples</span></div>{showCases ? <><div className={`review-summary ${reviewed && completed === requirements.length ? 'review-success' : reviewed ? 'review-needs-work' : 'review-success'}`}><span>{reviewed && completed < requirements.length ? <Lightbulb size={14} /> : <CheckCircle2 size={14} />}</span><p>{reviewed ? completed === requirements.length ? 'Your code has the expected prime-checking structure. The test suggestions below were not generated by running your code.' : `The code-shape review found ${requirements.length - completed} item${requirements.length - completed === 1 ? '' : 's'} to revisit. These suggestions are not results from your code.` : `${providerMode === 'openai' ? 'AI-generated suggestions' : 'Demo-generated examples'} only; nothing was executed. Items marked “confirm” or “define” need your input.`}</p></div><div className="test-list">{plan.sampleCases.map((test) => <div className="test-case" key={test.input}><span className="sample-mark">•</span><code>{test.input}</code><span className="test-values"><span>Expected</span><ArrowRight size={12} /><b>{test.expected}</b><i className="sample-tag">{test.expected.startsWith('Confirm') || test.expected.startsWith('Define') || test.expected.startsWith('Decide') ? 'SUGGESTED' : providerMode === 'openai' ? 'AI SUGGESTION' : 'DEMO SAMPLE'}</i></span></div>)}</div>{reviewed && <div className="review-checks">{requirements.map((item) => <div className={`review-check ${item.passed ? 'review-check-pass' : 'review-check-fail'}`} key={item.id}><span>{item.passed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}</span><span>{item.passed ? item.label : item.guidance}</span></div>)}</div>}</> : <div className="results-empty"><span className="empty-sparkle"><Sparkles size={16} /></span><span>Build a learning plan or review the code to see test suggestions. No code is executed.</span><ArrowDown size={14} /></div>}</section>
            </div>
          </div>

          <PythonExecutionPanel source={code} plan={plan} prompt={prompt} suggestedCases={plan.sampleCases} requirements={plan.requirements} contextKey={executionContextKey} onEvidenceChange={setExecutionEvidence} />

          <div className="section-heading lower-heading"><div><span className="section-number">02</span><h2>Debug with a nudge</h2><span className="section-sub">Try a hint when you get stuck. Each one gives a little more away.</span></div><span className="hint-progress">{hintLevel} of {plan.hints.length} hints</span></div>
          <section className="panel hints-panel">
            <div className="hint-intro"><div className="mini-icon lavender"><Lightbulb size={16} /></div><div><h3>Need a hint?</h3><p>{hintsMode === 'openai' ? 'AI-generated clues · revealed one at a time' : 'Demo-generated clues · revealed one at a time'}</p></div></div>
            <div className="hint-content" role="status" aria-label="Progressive hints" aria-busy={hintLoading}>{hintLevel === 0 ? <p className="hint-placeholder">Your first hint is ready when you are.</p> : plan.hints.slice(0, hintLevel).map((hint, index) => <div className="hint-item" key={`${index}-${hint}`}><span className="hint-index">HINT {index + 1}</span><p>{hint}</p></div>)}</div>
            {hintError && <p className="plan-generation-note" role="status">{hintError}</p>}
            <button className="hint-button" onClick={revealHint} disabled={hintLoading || hintLevel === plan.hints.length}>{hintLoading ? 'Loading first hint...' : hintLevel === plan.hints.length ? 'All hints revealed' : <><Lightbulb size={14} /> Reveal {hintLevel === 0 ? 'first' : 'next'} hint <ArrowRight size={14} /></>}</button>
          </section>

          <section id="bug-detective" className="feature-section">
            <div className="section-heading lower-heading"><div><span className="section-number">03</span><h2>Bug Detective</h2><span className="section-sub">Safe, fixed debugging puzzles. Nothing is executed.</span></div><span className="hint-progress">Challenge {bugIndex + 1} of {bugChallenges.length}</span></div>
            <div className="panel feature-panel">
              <div className="feature-heading"><div className="mini-icon amber"><Bug size={16} /></div><div><span className="feature-kicker">{currentBug.categoryLabel.toUpperCase()}</span><h3>{currentBug.title}</h3><p>{currentBug.description}</p></div></div>
              <p className="feature-objective"><b>Learning objective:</b> {currentBug.objective}</p>
              <pre className="bug-code"><code>{currentBug.buggyCode}</code></pre>
              <div className="feature-hints"><div className="coverage-requirement-heading"><b>Progressive hints</b><span>{bugHintLevel} of {currentBug.hints.length} revealed</span></div>{currentBug.hints.slice(0, bugHintLevel).map((hint, index) => <p className="mentor-hint" key={hint}><b>HINT {index + 1}</b> {hint}</p>)}<button className="hint-button" onClick={revealBugHint} disabled={bugHintLevel >= currentBug.hints.length}>{bugHintLevel >= currentBug.hints.length ? 'All challenge hints revealed' : `Reveal hint ${bugHintLevel + 1}`}</button></div>
              <label className="field-label" htmlFor="bug-category">Which bug category fits best?</label>
              <select id="bug-category" className="feature-select" value={bugCategory} onChange={(event) => setBugCategory(event.target.value as BugCategory | '')}><option value="">Choose a category</option>{bugCategories.map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}</select>
              <fieldset className="fix-options"><legend>Choose a repair strategy</legend>{currentBug.fixes.map((fix) => <label className="fix-option" key={fix.id}><input type="radio" name="bug-fix" value={fix.id} checked={bugFixId === fix.id} onChange={() => setBugFixId(fix.id)} /><span><b>{fix.label}</b><small>{fix.description}</small></span></label>)}</fieldset>
              <label className="field-label" htmlFor="proposed-fix">Record your proposed fix</label>
              <textarea id="proposed-fix" className="explanation-input" value={bugFixText} onChange={(event) => setBugFixText(event.target.value)} placeholder="Describe the change you would make…" />
              <div className="feature-actions"><button className="plan-button" onClick={submitDebugAttempt} disabled={!bugCategory || !bugFixId || !bugFixText.trim()}>Check my diagnosis <ArrowRight size={13} /></button><span>Score checks your selections against known reference fixtures; your text is not executed.</span></div>
              {debugResult && <div className={`debug-result ${debugResult.complete ? 'debug-success' : ''}`} role="status"><h4>{debugResult.complete ? 'Challenge complete' : 'Keep investigating'} · {debugResult.score}/100</h4><p>{debugResult.feedback}</p><ul><li>{debugResult.categoryIdentified ? '✓' : '○'} Identified the bug category (30 points)</li><li>{debugResult.fixSelected ? '✓' : '○'} Selected the matching repair (30 points)</li><li>{debugResult.fixtureCasesPassed}/{debugResult.fixtureCasesTotal} pre-verified reference cases match (40 points)</li></ul>{debugResult.complete && <button className="hint-button" onClick={tryNextBug}>Try another challenge <ArrowRight size={13} /></button>}</div>}
            </div>
          </section>

          <div className="section-heading lower-heading explain-heading"><div><span className="section-number">04</span><h2>Explain it in your own words</h2><span className="section-sub">Teaching it back is how you know it’s yours.</span></div></div>
          <section className="panel explain-panel">
            <div className="explain-top"><div className="explain-prompt"><div className="mini-icon blue"><MessageSquareText size={15} /></div><div><h3>{plan.id === 'prime' ? 'What happens when the function finds a divisor?' : 'Explain how your solution addresses one requirement.'}</h3><p>{plan.id === 'prime' ? <>Try to mention what <code>number % divisor</code> tells us.</> : 'This local demo offers reflection guidance only; it does not use AI.'}</p></div></div><span className="optional-tag">YOUR TURN</span></div>
            <textarea className="explanation-input" aria-label="Your explanation" placeholder="I think the function..." value={explanation} onChange={(event) => { setExplanation(event.target.value); setFeedback(null) }} />
            <div className="explain-footer"><span role="status" aria-label="Explanation feedback" className={feedback?.tone === 'positive' ? 'feedback-positive' : ''}>{feedback && <Sparkles size={14} />}{feedback?.message ?? 'Show your thinking.'}</span><button className="feedback-button" onClick={submitExplanation} disabled={!explanation.trim()}>Get feedback <ArrowRight size={14} /></button></div>
          </section>

          <section id="progress" className="feature-section">
            <div className="section-heading lower-heading"><div><span className="section-number">05</span><h2>Your learning progress</h2><span className="section-sub">{progressDescription}</span></div><button className="reset-button" onClick={resetLearnerProgress}><RotateCcw size={13} /> Reset progress</button></div>
            {storageWarning && <p className="storage-warning" role="status">{storageWarning}</p>}
            <div className="progress-grid">
              <section className="panel progress-panel level-panel"><div className="panel-heading"><div className="mini-icon purple"><GraduationCap size={16} /></div><div><h3>{levelProgress.current}</h3><p>Current learning level</p></div><b className="xp-value">{progress.xp} XP</b></div><div className="progress-track"><span style={{ width: `${levelProgress.progress}%` }} /></div><p className="coverage-caption">{levelProgress.next ? `${levelProgress.xpToNextLevel} XP to ${levelProgress.next}` : 'Top level reached'}</p><div className="progress-stats"><div><b>{progress.completedChallengeIds.length}</b><span>challenges completed</span></div><div><b>{progress.hintsUsed}</b><span>hints used</span></div><div><b>{progress.coverageResults.length}</b><span>coverage records</span></div></div></section>
              <section className="panel progress-panel"><div className="panel-heading"><div className="mini-icon amber"><Activity size={15} /></div><div><h3>Completion history</h3><p>Successful challenge events</p></div></div>{progress.history.length ? <ul className="history-list">{[...progress.history].reverse().slice(0, 5).map((item) => <li key={item.challengeId}><span><b>{item.challengeId.replace(/-/g, ' ')}</b><small>{new Date(item.completedAt).toLocaleDateString()} · {item.hintsUsed} hints</small></span><strong>{item.score}/100</strong></li>)}</ul> : <p className="empty-progress">Finish a Bug Detective challenge to start your history.</p>}</section>
              <section className="panel progress-panel"><div className="panel-heading"><div className="mini-icon blue"><ShieldCheck size={15} /></div><div><h3>Coverage history</h3><p>Illustrative reference-fixture scores</p></div></div>{progress.coverageResults.length ? <ul className="history-list">{[...progress.coverageResults].reverse().slice(0, 5).map((item, index) => <li key={`${item.challengeId}-${item.recordedAt}-${index}`}><span><b>{item.challengeId} · {new Date(item.recordedAt).toLocaleDateString()}</b><small>{item.passed} passed · {item.missing} missing · {item.untested} untested</small></span><strong>{item.score}/100</strong></li>)}</ul> : <p className="empty-progress">Build a learning plan to record its coverage summary.</p>}</section>
              <section className="panel progress-panel achievements-panel"><div className="panel-heading"><div className="mini-icon lavender"><Award size={15} /></div><div><h3>Achievements</h3><p>{progress.unlockedAchievements.length} of {ACHIEVEMENTS.length} unlocked</p></div></div><ul className="achievement-list">{ACHIEVEMENTS.map((item) => { const unlocked = progress.unlockedAchievements.includes(item.id); return <li className={unlocked ? 'achievement-earned' : ''} key={item.id}><span>{unlocked ? '✓' : '○'}</span><span><b>{item.title}</b><small>{item.description}{item.id === 'passed-tests' ? ' (requires server-verified tests; browser self-checks do not qualify)' : ''}</small></span><em>{unlocked ? 'EARNED' : 'LOCKED'}</em></li> })}</ul><p className="coverage-disclaimer">The “passed tests” achievement stays locked because browser self-checks are not server-verified tests.</p></section>
            </div>
          </section>

          <section id="mentor" className="feature-section">
            <div className="section-heading lower-heading"><div><span className="section-number">06</span><h2>AI Code Mentor</h2><span className="section-sub">Ask about this prompt, fixture results, your explanation, or the debugging challenge.</span></div></div>
            <div className="panel mentor-panel">
              <div className="panel-heading"><div className="mini-icon blue"><MessageSquareText size={15} /></div><div><h3>Contextual learning help</h3><p>Guiding questions and clues; not a complete solution.</p></div></div>
              <p className="mentor-opt-in-note">AI requests use the opt-in above. If it stays off—or no server key is configured—the mentor uses deterministic demo responses. Never include secrets in your question.</p>
              <label className="field-label" htmlFor="mentor-question">Your question</label>
              <textarea id="mentor-question" className="explanation-input" value={mentorQuestion} onChange={(event) => setMentorQuestion(event.target.value)} maxLength={1200} placeholder="Why does a zero remainder mean a number is composite?" />
              <div className="feature-actions"><button className="plan-button" onClick={askMentor} disabled={!mentorQuestion.trim() || mentorLoading}>{mentorLoading ? 'Thinking…' : 'Ask mentor'} <Send size={13} /></button><span>Context includes prompt, requirements, fixture status, challenge, and your written explanation/fix—not your editor source.</span></div>
              {mentorError && <p className="plan-generation-note" role="status">{mentorError}</p>}
              <div role="status" aria-label="Mentor response" aria-busy={mentorLoading}>
                {mentorReply && <div className="mentor-reply"><div className="mentor-source">{mentorReply.mode === 'openai' ? 'AI-GENERATED RESPONSE' : 'DEMO-GENERATED RESPONSE'} · CODE NOT RUN</div><p>{mentorReply.message}</p><p className="mentor-question"><b>Think about:</b> {mentorReply.guiding_question}</p><div className="mentor-clue">{mentorReply.hints.slice(0, mentorHintLevel).map((hint, index) => <p className="mentor-hint" key={hint}><b>CLUE {index + 1}</b> {hint}</p>)}</div><button className="hint-button" onClick={revealMentorHint} disabled={mentorHintLevel >= mentorReply.hints.length}>{mentorHintLevel === mentorReply.hints.length ? 'All mentor clues revealed' : `Reveal clue ${mentorHintLevel + 1}`}</button></div>}
              </div>
            </div>
          </section>

          <footer className="page-footer"><span><ShieldIcon /> Your code stays yours. Python runs in a browser worker, not on the server.</span><button onClick={() => navigateTo('mentor')}>Ask the mentor <ArrowRight size={13} /></button></footer>
        </div>
      </main>
    </div>
  )
}

function ShieldIcon() { return <span className="shield-mark">✓</span> }

export default App
