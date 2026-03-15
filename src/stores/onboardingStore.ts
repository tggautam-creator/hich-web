import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface OnboardingState {
  hasSeenIntro: boolean
  hasSeenWalkthrough: boolean
  setIntroSeen: () => void
  setWalkthroughSeen: () => void
  resetTour: () => void
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      hasSeenIntro: false,
      hasSeenWalkthrough: false,
      setIntroSeen: () => set({ hasSeenIntro: true }),
      setWalkthroughSeen: () => set({ hasSeenWalkthrough: true }),
      resetTour: () => set({ hasSeenIntro: false, hasSeenWalkthrough: false }),
    }),
    { name: 'hich-onboarding' },
  ),
)
