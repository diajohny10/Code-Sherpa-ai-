import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearProgress,
  createEmptyProgress,
  getLevelProgress,
  loadProgress,
  recordChallengeCompletion,
  recordClearExplanation,
  recordCoverageResult,
  recordHintUsed,
  saveProgress,
  validateProgress,
} from '../src/progress.ts'

function memoryStorage(initial = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next },
    removeItem: () => { value = null },
    current: () => value,
  }
}

const completion = (overrides = {}) => ({ challengeId: 'bug-age-boundary', kind: 'bug-detective',
  completedAt: '2026-10-23T12:00:00.000Z', score: 100, hintsUsed: 0, verifiedTestsPassed: false, ...overrides })

test('XP, levels, and achievements progress according to the centralized rules', () => {
  const first = recordChallengeCompletion(createEmptyProgress(), completion())
  assert.equal(first.xp, 80)
  assert.equal(getLevelProgress(first.xp).current, 'Beginner')
  assert.ok(first.unlockedAchievements.includes('first-challenge'))
  assert.ok(first.unlockedAchievements.includes('solved-bug'))
  assert.ok(first.unlockedAchievements.includes('no-hints'))
  assert.ok(!first.unlockedAchievements.includes('passed-tests'))
  const explain = recordClearExplanation(first)
  assert.ok(explain.unlockedAchievements.includes('clear-explanation'))
  assert.equal(explain.xp, 90)
  assert.equal(getLevelProgress(130).current, 'Explorer')
  assert.equal(getLevelProgress(250).current, 'Debugger')
  assert.equal(getLevelProgress(500).current, 'Code Mentor')
})

test('completion rewards and achievements cannot be awarded twice for the same challenge', () => {
  const first = recordChallengeCompletion(createEmptyProgress(), completion())
  const duplicate = recordChallengeCompletion(first, completion())
  assert.equal(duplicate.xp, first.xp)
  assert.equal(duplicate.history.length, 1)
})

test('unverified demo fixture results do not unlock passed-tests achievement', () => {
  const state = recordChallengeCompletion(createEmptyProgress(), completion({ verifiedTestsPassed: false }))
  assert.ok(!state.unlockedAchievements.includes('passed-tests'))
  const verified = recordChallengeCompletion(createEmptyProgress(), completion({
    challengeId: 'verified-real-test-event', verifiedTestsPassed: true,
  }))
  assert.ok(verified.unlockedAchievements.includes('passed-tests'))
})

test('coverage and hints are recorded locally without awarding completion XP', () => {
  const progress = recordHintUsed(recordCoverageResult(createEmptyProgress(), {
    challengeId: 'prime', recordedAt: '2026-10-23T12:00:00.000Z', score: 75, passed: 3, missing: 1, untested: 0,
  }))
  assert.equal(progress.coverageResults.length, 1)
  assert.equal(progress.hintsUsed, 1)
  assert.equal(progress.xp, 0)
})

test('storage round-trip persists progress, malformed and outdated records reset safely', () => {
  const storage = memoryStorage()
  const progress = recordChallengeCompletion(createEmptyProgress(), completion())
  assert.equal(saveProgress(progress, storage), true)
  assert.equal(loadProgress(storage).xp, progress.xp)
  storage.setItem('', '{broken json')
  assert.equal(loadProgress(storage).xp, 0)
  const oldVersion = { ...progress, version: 0 }
  assert.equal(validateProgress(oldVersion), null)
  storage.setItem('', JSON.stringify(oldVersion))
  assert.equal(loadProgress(storage).xp, 0)
})

test('reset removes stored data and returns a clean state', () => {
  const storage = memoryStorage('persisted')
  assert.equal(clearProgress(storage).xp, 0)
  assert.equal(storage.current(), null)
})

test('storage errors are handled without crashing the learner app', () => {
  const unavailable = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('quota') },
    removeItem() { throw new Error('blocked') },
  }
  assert.equal(loadProgress(unavailable).xp, 0)
  assert.equal(saveProgress(createEmptyProgress(), unavailable), false)
  assert.equal(clearProgress(unavailable).xp, 0)
})

test('persisting and restoring cannot unlock verified execution claims', () => {
  const verified = recordChallengeCompletion(createEmptyProgress(), completion({ verifiedTestsPassed: true }))
  const storage = memoryStorage(JSON.stringify(verified))
  const restored = loadProgress(storage)
  assert.ok(!restored.unlockedAchievements.includes('passed-tests'))
  assert.equal(restored.history[0].verifiedTestsPassed, false)
  assert.equal(restored.xp, verified.xp - 10)
  assert.equal(saveProgress(verified, storage), true)
  assert.ok(!JSON.parse(storage.current()).unlockedAchievements.includes('passed-tests'))
})
