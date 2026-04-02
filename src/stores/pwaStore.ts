import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PwaState {
  hasSeenFullPrompt: boolean
  hasDismissedBanner: boolean
  setSeenFullPrompt: () => void
  setDismissedBanner: () => void
}

export const usePwaStore = create<PwaState>()(
  persist(
    (set) => ({
      hasSeenFullPrompt: false,
      hasDismissedBanner: false,
      setSeenFullPrompt: () => set({ hasSeenFullPrompt: true }),
      setDismissedBanner: () => set({ hasDismissedBanner: true }),
    }),
    { name: 'tago-pwa' },
  ),
)
