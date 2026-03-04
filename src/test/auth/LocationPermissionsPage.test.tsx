import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import LocationPermissionsPage from '@/components/auth/LocationPermissionsPage'

// ── Mocks ────────────────────────────────────────────────────────────────────
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── Helpers ──────────────────────────────────────────────────────────────────
const mockGetCurrentPosition = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(global.navigator, 'geolocation', {
    value: { getCurrentPosition: mockGetCurrentPosition },
    configurable: true,
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <LocationPermissionsPage />
    </MemoryRouter>,
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('LocationPermissionsPage', () => {
  describe('rendering', () => {
    it('renders the page with correct testid', () => {
      renderPage()
      expect(screen.getByTestId('location-permissions-page')).toBeDefined()
    })

    it('shows heading', () => {
      renderPage()
      expect(screen.getByText('Enable location')).toBeDefined()
    })

    it('shows explanation text', () => {
      renderPage()
      expect(
        screen.getByText(/HICH uses your location to find drivers heading your way/),
      ).toBeDefined()
    })

    it('renders the allow button', () => {
      renderPage()
      expect(screen.getByTestId('allow-button')).toBeDefined()
    })

    it('does not show denied instructions initially', () => {
      renderPage()
      expect(screen.queryByTestId('denied-instructions')).toBeNull()
    })
  })

  describe('geolocation grant', () => {
    it('navigates to /onboarding/mode on success', async () => {
      mockGetCurrentPosition.mockImplementation(
        (success: PositionCallback) => {
          success({ coords: { latitude: 38.54, longitude: -121.74 } } as GeolocationPosition)
        },
      )
      renderPage()
      fireEvent.click(screen.getByTestId('allow-button'))
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/onboarding/mode')
      })
    })
  })

  describe('geolocation deny', () => {
    it('shows denied instructions when geolocation is rejected', async () => {
      mockGetCurrentPosition.mockImplementation(
        (_success: PositionCallback, error: PositionErrorCallback) => {
          error({ code: 1, message: 'User denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
        },
      )
      renderPage()
      fireEvent.click(screen.getByTestId('allow-button'))
      await waitFor(() => {
        expect(screen.getByTestId('denied-instructions')).toBeDefined()
      })
    })

    it('hides the allow button when denied', async () => {
      mockGetCurrentPosition.mockImplementation(
        (_success: PositionCallback, error: PositionErrorCallback) => {
          error({ code: 1, message: 'User denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
        },
      )
      renderPage()
      fireEvent.click(screen.getByTestId('allow-button'))
      await waitFor(() => {
        expect(screen.queryByTestId('allow-button')).toBeNull()
      })
    })

    it('shows step-by-step instructions for re-enabling', async () => {
      mockGetCurrentPosition.mockImplementation(
        (_success: PositionCallback, error: PositionErrorCallback) => {
          error({ code: 1, message: 'User denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
        },
      )
      renderPage()
      fireEvent.click(screen.getByTestId('allow-button'))
      await waitFor(() => {
        expect(screen.getByText(/Open your browser settings/)).toBeDefined()
        expect(screen.getByText(/Refresh the page and try again/)).toBeDefined()
      })
    })

    it('does not navigate when denied', async () => {
      mockGetCurrentPosition.mockImplementation(
        (_success: PositionCallback, error: PositionErrorCallback) => {
          error({ code: 1, message: 'User denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
        },
      )
      renderPage()
      fireEvent.click(screen.getByTestId('allow-button'))
      await waitFor(() => {
        expect(screen.getByTestId('denied-instructions')).toBeDefined()
      })
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  describe('no geolocation API', () => {
    it('shows denied instructions if geolocation is unavailable', () => {
      Object.defineProperty(global.navigator, 'geolocation', {
        value: undefined,
        configurable: true,
      })
      renderPage()
      fireEvent.click(screen.getByTestId('allow-button'))
      expect(screen.getByTestId('denied-instructions')).toBeDefined()
    })
  })
})
