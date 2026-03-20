import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SpotlightOverlay from '@/components/onboarding/SpotlightOverlay'

const mockSetWalkthroughSeen = vi.fn()

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ hasSeenWalkthrough: false, setWalkthroughSeen: mockSetWalkthroughSeen }),
}))

describe('SpotlightOverlay', () => {
  beforeEach(() => {
    mockSetWalkthroughSeen.mockClear()
    // Ensure portal root exists
    if (!document.getElementById('portal-root')) {
      const el = document.createElement('div')
      el.id = 'portal-root'
      document.body.appendChild(el)
    }
    // Create mock target elements for all 6 steps
    for (const testId of ['search-bar', 'ride-board-button', 'driver-tab', 'rides-tab', 'wallet-tab', 'profile-tab']) {
      if (!document.querySelector(`[data-testid="${testId}"]`)) {
        const el = document.createElement('div')
        el.setAttribute('data-testid', testId)
        el.getBoundingClientRect = () => ({
          top: 100, left: 50, bottom: 140, right: 200,
          width: 150, height: 40, x: 50, y: 100, toJSON: () => ({}),
        })
        document.body.appendChild(el)
      }
    }
  })

  it('renders the overlay', () => {
    render(<SpotlightOverlay />)
    expect(screen.getByTestId('spotlight-overlay')).toBeDefined()
  })

  it('shows step 1 — Where are you headed?', () => {
    render(<SpotlightOverlay />)
    expect(screen.getByTestId('spotlight-title').textContent).toBe('Where are you headed?')
  })

  it('shows step indicator for 6 steps', () => {
    render(<SpotlightOverlay />)
    expect(screen.getByText('1 of 6')).toBeDefined()
  })

  it('advances to ride board step', () => {
    render(<SpotlightOverlay />)
    fireEvent.click(screen.getByTestId('spotlight-next'))
    expect(screen.getByTestId('spotlight-title').textContent).toBe('Browse upcoming rides')
    expect(screen.getByText('2 of 6')).toBeDefined()
  })

  it('advances to driver step', () => {
    render(<SpotlightOverlay />)
    fireEvent.click(screen.getByTestId('spotlight-next')) // → ride board
    fireEvent.click(screen.getByTestId('spotlight-next')) // → driver
    expect(screen.getByTestId('spotlight-title').textContent).toBe('Earn while you drive')
  })

  it('calls setWalkthroughSeen on skip', () => {
    render(<SpotlightOverlay />)
    fireEvent.click(screen.getByTestId('spotlight-skip'))
    expect(mockSetWalkthroughSeen).toHaveBeenCalledOnce()
  })

  it('calls setWalkthroughSeen on last step', () => {
    render(<SpotlightOverlay />)
    fireEvent.click(screen.getByTestId('spotlight-next')) // step 2
    fireEvent.click(screen.getByTestId('spotlight-next')) // step 3
    fireEvent.click(screen.getByTestId('spotlight-next')) // step 4
    fireEvent.click(screen.getByTestId('spotlight-next')) // step 5
    fireEvent.click(screen.getByTestId('spotlight-next')) // step 6 (last)
    expect(screen.getByText('Got it!')).toBeDefined()
    fireEvent.click(screen.getByTestId('spotlight-next')) // finish
    expect(mockSetWalkthroughSeen).toHaveBeenCalledOnce()
  })
})
