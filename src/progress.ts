export const PROGRESS_KEY = 'code-sherpa-ai.progress.v1'
export const PROGRESS_VERSION = 1 as const

export const LEVELS = [
  { name: 'Beginner', minimumXp: 0 },
  { name: 'Explorer', minimumXp: 100 },
  { name: 'Debugger', minimumXp: 250 },
  { name: 'Code Mentor', minimumXp: 500 },
] as const

export const ACHIEVEMENTS = [
  { id: 'first-challenge', title: 'First steps', description: 'Complete your first learning challenge.' },
  { id: 'passed-tests', title: 'Tested and true', description: 'Pass verified tests for your solution.' },
  { id: 'solved-bug', title: 'Bug Detective', description: 'Solve a debugging challenge.' },
  { id: 'no-hints', title: 'Trailblazer', description: 'Solve a debugging challenge without hints.' },
  { id: 'clear-explanation', title: 'Clear explainer', description: 'Explain a concept clearly.' },
] as const

export type AchievementId = typeof ACHIEVEMENTS[number]['id']
export type ProgressHistoryEntry = {
  challengeId: string
  kind: 'learning' | 'bug-detective'
  completedAt: string
  score: number
  hintsUsed: number
  verifiedTestsPassed: boolean
}
export type CoverageProgressEntry = {
  challengeId: string
  recordedAt: string
  score: number
  passed: number
  missing: number
  untested: number
}
export type ProgressState = {
  version: typeof PROGRESS_VERSION
  xp: number
  completedChallengeIds: string[]
  history: ProgressHistoryEntry[]
  coverageResults: CoverageProgressEntry[]
  hintsUsed: number
  unlockedAchievements: AchievementId[]
  rewardedEvents: string[]
}
export type ProgressStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function createEmptyProgress(): ProgressState {
  return { version: PROGRESS_VERSION, xp: 0, completedChallengeIds: [], history: [],
    coverageResults: [], hintsUsed: 0, unlockedAchievements: [], rewardedEvents: [] }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringArray = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string' && item.length > 0)
const isCount = (value: unknown, max = 1_000_000): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max

export function validateProgress(value: unknown): ProgressState | null {
  if (!isRecord(value) || value.version !== PROGRESS_VERSION || !isCount(value.xp) ||
      !isStringArray(value.completedChallengeIds, 1_000) || !Array.isArray(value.history) || value.history.length > 200 ||
      !Array.isArray(value.coverageResults) || value.coverageResults.length > 200 || !isCount(value.hintsUsed) ||
      !isStringArray(value.unlockedAchievements, ACHIEVEMENTS.length) ||
      !value.unlockedAchievements.every((id) => ACHIEVEMENTS.some((achievement) => achievement.id === id)) ||
      !isStringArray(value.rewardedEvents, 2_000)) return null

  const history = value.history
  if (!history.every((entry) => isRecord(entry) && typeof entry.challengeId === 'string' &&
      (entry.kind === 'learning' || entry.kind === 'bug-detective') && typeof entry.completedAt === 'string' &&
      Number.isFinite(Date.parse(entry.completedAt)) && isCount(entry.score, 100) && isCount(entry.hintsUsed, 100) &&
      typeof entry.verifiedTestsPassed === 'boolean')) return null
  const coverageResults = value.coverageResults
  if (!coverageResults.every((entry) => isRecord(entry) && typeof entry.challengeId === 'string' &&
      typeof entry.recordedAt === 'string' && Number.isFinite(Date.parse(entry.recordedAt)) &&
      isCount(entry.score, 100) && isCount(entry.passed, 200) && isCount(entry.missing, 200) && isCount(entry.untested, 200))) return null

  return withoutExecutionClaims({
    version: PROGRESS_VERSION, xp: value.xp,
    completedChallengeIds: [...value.completedChallengeIds],
    history: history.map((entry) => ({ ...(entry as unknown as ProgressHistoryEntry) })),
    coverageResults: coverageResults.map((entry) => ({ ...(entry as unknown as CoverageProgressEntry) })),
    hintsUsed: value.hintsUsed,
    unlockedAchievements: [...value.unlockedAchievements] as AchievementId[],
    rewardedEvents: [...value.rewardedEvents],
  })
}

export function withoutExecutionClaims(progress: ProgressState): ProgressState {
  const rewarded = progress.rewardedEvents.includes('achievement:passed-tests')
  return {
    ...progress,
    xp: Math.max(0, progress.xp - (rewarded ? 10 : 0)),
    unlockedAchievements: progress.unlockedAchievements.filter((id) => id !== 'passed-tests'),
    rewardedEvents: progress.rewardedEvents.filter((id) => id !== 'achievement:passed-tests'),
    history: progress.history.map((entry) => ({ ...entry, verifiedTestsPassed: false })),
  }
}

export function loadProgress(storage?: ProgressStorage): ProgressState {
  try {
    const target = storage ?? window.localStorage
    const raw = target.getItem(PROGRESS_KEY)
    if (!raw) return createEmptyProgress()
    return validateProgress(JSON.parse(raw)) ?? createEmptyProgress()
  } catch {
    return createEmptyProgress()
  }
}

export function saveProgress(progress: ProgressState, storage?: ProgressStorage): boolean {
  try {
    const target = storage ?? window.localStorage
    target.setItem(PROGRESS_KEY, JSON.stringify(withoutExecutionClaims(progress)))
    return true
  } catch {
    return false
  }
}

export function clearProgress(storage?: ProgressStorage): ProgressState {
  try {
    const target = storage ?? window.localStorage
    target.removeItem(PROGRESS_KEY)
  } catch {
    // State still resets for this page session when browser storage is unavailable.
  }
  return createEmptyProgress()
}

function awardXp(progress: ProgressState, eventId: string, amount: number): ProgressState {
  if (progress.rewardedEvents.includes(eventId)) return progress
  return { ...progress, xp: progress.xp + amount, rewardedEvents: [...progress.rewardedEvents, eventId] }
}

function unlock(progress: ProgressState, id: AchievementId): ProgressState {
  if (progress.unlockedAchievements.includes(id)) return progress
  const next = { ...progress, unlockedAchievements: [...progress.unlockedAchievements, id] }
  return awardXp(next, `achievement:${id}`, 10)
}

export function recordCoverageResult(progress: ProgressState, entry: CoverageProgressEntry): ProgressState {
  return { ...progress, coverageResults: [...progress.coverageResults, entry].slice(-200) }
}

export function recordHintUsed(progress: ProgressState): ProgressState {
  return { ...progress, hintsUsed: progress.hintsUsed + 1 }
}

export function recordChallengeCompletion(
  progress: ProgressState,
  entry: ProgressHistoryEntry,
): ProgressState {
  if (progress.completedChallengeIds.includes(entry.challengeId) || entry.score < 100) return progress
  let next: ProgressState = {
    ...progress,
    completedChallengeIds: [...progress.completedChallengeIds, entry.challengeId],
    history: [...progress.history, entry].slice(-200),
  }
  next = awardXp(next, `challenge:${entry.challengeId}`, entry.kind === 'bug-detective' ? 50 : 40)
  next = unlock(next, 'first-challenge')
  if (entry.kind === 'bug-detective') next = unlock(next, 'solved-bug')
  if (entry.kind === 'bug-detective' && entry.hintsUsed === 0) next = unlock(next, 'no-hints')
  if (entry.verifiedTestsPassed) next = unlock(next, 'passed-tests')
  return next
}

export function recordClearExplanation(progress: ProgressState): ProgressState {
  return unlock(progress, 'clear-explanation')
}

export function getLevelProgress(xp: number) {
  const currentIndex = LEVELS.reduce((result, level, index) => xp >= level.minimumXp ? index : result, 0)
  const current = LEVELS[currentIndex]
  const next = LEVELS[currentIndex + 1]
  const progress = next
    ? Math.round(((xp - current.minimumXp) / (next.minimumXp - current.minimumXp)) * 100)
    : 100
  return { current: current.name, next: next?.name ?? null, progress,
    xpIntoLevel: xp - current.minimumXp, xpToNextLevel: next ? next.minimumXp - xp : 0 }
}
