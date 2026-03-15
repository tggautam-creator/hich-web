import { describe, it, expect, beforeEach } from 'vitest'
import { useOnboardingStore } from '@/stores/onboardingStore'

describe('onboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().resetTour()
  })

  it('starts with both flags false', () => {
    const state = useOnboardingStore.getState()
    expect(state.hasSeenIntro).toBe(false)
    expect(state.hasSeenWalkthrough).toBe(false)
  })

  it('setIntroSeen sets hasSeenIntro to true', () => {
    useOnboardingStore.getState().setIntroSeen()
    expect(useOnboardingStore.getState().hasSeenIntro).toBe(true)
    expect(useOnboardingStore.getState().hasSeenWalkthrough).toBe(false)
  })

  it('setWalkthroughSeen sets hasSeenWalkthrough to true', () => {
    useOnboardingStore.getState().setWalkthroughSeen()
    expect(useOnboardingStore.getState().hasSeenWalkthrough).toBe(true)
  })

  it('resetTour resets both flags', () => {
    useOnboardingStore.getState().setIntroSeen()
    useOnboardingStore.getState().setWalkthroughSeen()
    useOnboardingStore.getState().resetTour()
    expect(useOnboardingStore.getState().hasSeenIntro).toBe(false)
    expect(useOnboardingStore.getState().hasSeenWalkthrough).toBe(false)
  })
})
