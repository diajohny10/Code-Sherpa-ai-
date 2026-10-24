import { useEffect, useState } from 'react'
import { createEmptyProgress, loadProgress, saveProgress, withoutExecutionClaims, type ProgressState } from './progress'

export type ProgressStore = {
  load(): ProgressState
  save(progress: ProgressState): boolean | Promise<boolean>
  dispose?(): void
  getStatus?(): string
  subscribe?(listener: () => void): () => void
}

export const localProgressStore: ProgressStore = { load: loadProgress, save: saveProgress }

export function useLearningProgress(store: ProgressStore = localProgressStore) {
  const [progress, setProgress] = useState(() => withoutExecutionClaims(store.load()))
  const [storageWarning, setStorageWarning] = useState('')

  useEffect(() => {
    let active = true
    const warning = () => store.getStatus?.() ?? 'Progress could not be saved by this browser. It is available only until this page closes.'
    const unsubscribe = store.subscribe?.(() => { if (active) setStorageWarning(store.getStatus?.() ?? '') })
    Promise.resolve(store.save(progress)).then((saved) => {
      if (active) setStorageWarning(saved ? '' : warning())
    }, () => { if (active) setStorageWarning(warning()) })
    return () => { active = false; unsubscribe?.() }
  }, [progress, store])

  const updateProgress = (update: (current: ProgressState) => ProgressState) => {
    setProgress((current) => withoutExecutionClaims(update(current)))
  }
  const resetProgress = () => setProgress(createEmptyProgress())

  return { progress, updateProgress, resetProgress, storageWarning }
}