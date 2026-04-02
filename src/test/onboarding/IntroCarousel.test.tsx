import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import IntroCarousel from '@/components/onboarding/IntroCarousel'

const mockSetIntroSeen = vi.fn()

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ hasSeenIntro: false, setIntroSeen: mockSetIntroSeen }),
}))

describe('IntroCarousel', () => {
  beforeEach(() => {
    mockSetIntroSeen.mockClear()
  })

  it('renders the first slide with welcome messaging', () => {
    render(<IntroCarousel />)
    expect(screen.getByTestId('intro-carousel')).toBeDefined()
    expect(screen.getByTestId('slide-title-welcome')).toBeDefined()
    expect(screen.getByText('Going the same way?')).toBeDefined()
  })

  it('renders skip button on first slide', () => {
    render(<IntroCarousel />)
    expect(screen.getByTestId('skip-button')).toBeDefined()
  })

  it('advances to real-time matching slide', () => {
    render(<IntroCarousel />)
    fireEvent.click(screen.getByTestId('next-button'))
    expect(screen.getByTestId('slide-title-realtime')).toBeDefined()
    expect(screen.getByText('Just tap and go')).toBeDefined()
  })

  it('calls setIntroSeen on skip', () => {
    render(<IntroCarousel />)
    fireEvent.click(screen.getByTestId('skip-button'))
    expect(mockSetIntroSeen).toHaveBeenCalledOnce()
  })

  it('calls setIntroSeen on last slide finish', () => {
    render(<IntroCarousel />)
    // Advance through all 5 slides
    fireEvent.click(screen.getByTestId('next-button')) // → realtime
    fireEvent.click(screen.getByTestId('next-button')) // → safety
    fireEvent.click(screen.getByTestId('next-button')) // → earn
    fireEvent.click(screen.getByTestId('next-button')) // → get-started (last)
    expect(screen.getByText('Find my first ride')).toBeDefined()
    fireEvent.click(screen.getByTestId('next-button')) // finish
    expect(mockSetIntroSeen).toHaveBeenCalledOnce()
  })

  it('shows dot indicators for all slides', () => {
    render(<IntroCarousel />)
    const dots = screen.getByTestId('dot-indicators')
    expect(dots).toBeDefined()
    // 5 slides = 5 dot buttons
    expect(dots.querySelectorAll('button')).toHaveLength(5)
  })

  it('shows selling points across slides', () => {
    render(<IntroCarousel />)
    // First slide mentions going the same way
    expect(screen.getByText(/Going the same way/)).toBeDefined()
  })
})
