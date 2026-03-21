/**
 * DestinationSearch tests
 *
 * Verifies:
 *  1.  Page wrapper renders with default data-testid
 *  2.  Search input renders
 *  3.  Back button calls navigate(-1)
 *  4.  From label shows location name from router state
 *  5.  Recent destinations shown when input is empty and recent list exists
 *  6.  Recent destinations NOT shown when input has text
 *  7.  Recent section NOT shown when localStorage is empty
 *  8.  Does NOT call searchPlaces before 300 ms debounce fires
 *  9.  Calls searchPlaces with the query after 300 ms
 * 10.  Debounce resets on continued typing
 * 11.  Shows loading indicator while fetch is in-flight
 * 12.  Shows results list after fetch resolves with matches
 * 13.  Shows no-results state after fetch resolves with empty array
 * 14.  Selecting a result fills the Drop Off field
 * 15.  Done button disabled when no destination selected
 * 16.  Done button navigates to /ride/confirm after selecting a destination
 * 17.  Done button saves recent destination
 * 18.  Selecting a recent item fills the Drop Off field
 * 19.  Clear button clears the query and selection
 * 20.  Custom data-testid forwarded to root wrapper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DestinationSearch from '@/components/ride/DestinationSearch'
import type { PlaceSuggestion } from '@/lib/places'

// ── Mock places module ────────────────────────────────────────────────────────

const mockSearchPlaces          = vi.fn<() => Promise<PlaceSuggestion[]>>()
const mockGetRecentDestinations = vi.fn<() => PlaceSuggestion[]>()
const mockSaveRecentDestination = vi.fn<(place: PlaceSuggestion) => void>()

vi.mock('@/lib/places', () => ({
  searchPlaces:          (...args: Parameters<typeof mockSearchPlaces>)          => mockSearchPlaces(...args),
  getRecentDestinations: (...args: Parameters<typeof mockGetRecentDestinations>) => mockGetRecentDestinations(...args),
  saveRecentDestination: (...args: Parameters<typeof mockSaveRecentDestination>) => mockSaveRecentDestination(...args),
}))

// ── Mock directions module ────────────────────────────────────────────────────

const mockGetDirections = vi.fn<() => Promise<{ distance_km: number; duration_min: number; polyline: string } | null>>()

vi.mock('@/lib/directions', () => ({
  getDirections: (...args: Parameters<typeof mockGetDirections>) => mockGetDirections(...args),
}))

// ── Mock react-router-dom navigate ───────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PLACE_A: PlaceSuggestion = {
  placeId:       'place-001',
  mainText:      'UC Davis',
  secondaryText: 'Davis, CA, USA',
  fullAddress:   'UC Davis, Davis, CA, USA',
}

const PLACE_B: PlaceSuggestion = {
  placeId:       'place-002',
  mainText:      'Sacramento Airport',
  secondaryText: 'Sacramento, CA, USA',
  fullAddress:   'Sacramento International Airport, Sacramento, CA, USA',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage(locationState?: Record<string, unknown>) {
  const entries = [{ pathname: '/ride/search', state: locationState }]
  return render(
    <MemoryRouter initialEntries={entries}>
      <DestinationSearch />
    </MemoryRouter>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DestinationSearch', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    mockSearchPlaces.mockResolvedValue([])
    mockGetRecentDestinations.mockReturnValue([])
    mockSaveRecentDestination.mockReset()
    mockGetDirections.mockResolvedValue(null)
  })

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders the page wrapper with default data-testid', () => {
    renderPage()
    expect(screen.getByTestId('destination-search-page')).toBeInTheDocument()
  })

  it('renders the search input', () => {
    renderPage()
    expect(screen.getByTestId('search-input')).toBeInTheDocument()
  })

  it('shows "From" label with location name from router state', () => {
    renderPage({ locationName: 'University of California, Davis' })
    expect(screen.getByTestId('from-label')).toHaveTextContent('University of California, Davis')
  })

  it('shows "Current Location" as default From label', () => {
    renderPage()
    expect(screen.getByTestId('from-label')).toHaveTextContent('Current Location')
  })

  // ── Back button ────────────────────────────────────────────────────────────

  it('back button calls navigate(-1)', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('back-button'))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  // ── Recent destinations ────────────────────────────────────────────────────

  it('shows recent destinations when input is empty and recent list is non-empty', () => {
    mockGetRecentDestinations.mockReturnValue([PLACE_A, PLACE_B])
    renderPage()
    expect(screen.getByTestId('recent-section')).toBeInTheDocument()
    expect(screen.getAllByTestId('recent-item')).toHaveLength(2)
  })

  it('hides recent destinations when the input has text', async () => {
    mockGetRecentDestinations.mockReturnValue([PLACE_A])
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('search-input'), 'UC')
    expect(screen.queryByTestId('recent-section')).not.toBeInTheDocument()
  })

  it('does not render recent section when localStorage is empty', () => {
    mockGetRecentDestinations.mockReturnValue([])
    renderPage()
    expect(screen.queryByTestId('recent-section')).not.toBeInTheDocument()
  })

  // ── Debounce ───────────────────────────────────────────────────────────────

  describe('debounce', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(()  => { vi.useRealTimers() })

    it('does NOT call searchPlaces before 300 ms', () => {
      renderPage()
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'UC Davis' } })
      act(() => { vi.advanceTimersByTime(299) })
      expect(mockSearchPlaces).not.toHaveBeenCalled()
    })

    it('calls searchPlaces with the query after 300 ms', () => {
      renderPage()
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'UC Davis' } })
      act(() => { vi.advanceTimersByTime(300) })
      expect(mockSearchPlaces).toHaveBeenCalledWith('UC Davis', expect.any(String))
    })

    it('resets the timer if the user keeps typing (only one fetch for the final value)', () => {
      renderPage()
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'U' } })
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'UC Davis' } })
      act(() => { vi.advanceTimersByTime(600) })
      expect(mockSearchPlaces).not.toHaveBeenCalledWith('U', expect.any(String))
      expect(mockSearchPlaces).toHaveBeenCalledWith('UC Davis', expect.any(String))
    })
  })

  // ── Loading state ──────────────────────────────────────────────────────────

  it('shows loading indicator while fetch is in-flight', async () => {
    mockSearchPlaces.mockReturnValue(new Promise(() => { /* pending */ }))
    vi.useFakeTimers()

    renderPage()
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'UC Davis' } })
    act(() => { vi.advanceTimersByTime(300) })

    expect(screen.getByTestId('search-loading')).toBeInTheDocument()

    vi.useRealTimers()
  })

  // ── Results ────────────────────────────────────────────────────────────────

  it('shows results after fetch resolves with matches', async () => {
    mockSearchPlaces.mockResolvedValue([PLACE_A, PLACE_B])
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('search-input'), 'UC')
    await waitFor(() => {
      expect(screen.getAllByTestId('result-item')).toHaveLength(2)
    }, { timeout: 1000 })
  })

  it('shows no-results state after fetch resolves with empty array', async () => {
    mockSearchPlaces.mockResolvedValue([])
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('search-input'), 'zzzzz')
    await waitFor(() => {
      expect(screen.getByTestId('no-results')).toBeInTheDocument()
    }, { timeout: 1000 })
  })

  // ── Selection + Done ───────────────────────────────────────────────────────

  it('selecting a result fills the Drop Off input with the place name', async () => {
    mockSearchPlaces.mockResolvedValue([PLACE_A])
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('search-input'), 'UC')
    await waitFor(() => screen.getAllByTestId('result-item'))
    await user.click(screen.getAllByTestId('result-item')[0])
    expect((screen.getByTestId('search-input') as HTMLInputElement).value).toBe('UC Davis')
  })

  it('Done button is disabled when no destination is selected', () => {
    renderPage()
    expect(screen.getByTestId('done-button')).toBeDisabled()
  })

  it('Done button navigates to /ride/confirm with destination after selecting', async () => {
    mockSearchPlaces.mockResolvedValue([PLACE_A])
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('search-input'), 'UC')
    await waitFor(() => screen.getAllByTestId('result-item'))
    await user.click(screen.getAllByTestId('result-item')[0])
    await user.click(screen.getByTestId('done-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/ride/confirm', {
        state: { destination: PLACE_A, originLat: undefined, originLng: undefined },
      })
    })
  })

  it('Done button saves the destination via saveRecentDestination', async () => {
    mockSearchPlaces.mockResolvedValue([PLACE_A])
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('search-input'), 'UC')
    await waitFor(() => screen.getAllByTestId('result-item'))
    await user.click(screen.getAllByTestId('result-item')[0])
    await user.click(screen.getByTestId('done-button'))
    await waitFor(() => {
      expect(mockSaveRecentDestination).toHaveBeenCalledWith(PLACE_A)
    })
  })

  it('selecting a recent item fills the Drop Off input', async () => {
    mockGetRecentDestinations.mockReturnValue([PLACE_B])
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('recent-item'))
    expect((screen.getByTestId('search-input') as HTMLInputElement).value).toBe('Sacramento Airport')
  })

  it('Done navigates after selecting a recent item', async () => {
    mockGetRecentDestinations.mockReturnValue([PLACE_B])
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('recent-item'))
    await user.click(screen.getByTestId('done-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/ride/confirm', {
        state: { destination: PLACE_B, originLat: undefined, originLng: undefined },
      })
    })
  })

  // ── Clear button ───────────────────────────────────────────────────────────

  it('clear button resets the query and deselects destination', async () => {
    mockSearchPlaces.mockResolvedValue([PLACE_A])
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('search-input'), 'UC')
    await waitFor(() => screen.getAllByTestId('result-item'))
    await user.click(screen.getAllByTestId('result-item')[0])
    await user.click(screen.getByTestId('clear-button'))
    expect((screen.getByTestId('search-input') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('done-button')).toBeDisabled()
  })

  // ── Custom testId ──────────────────────────────────────────────────────────

  it('forwards a custom data-testid to the root wrapper', () => {
    render(
      <MemoryRouter>
        <DestinationSearch data-testid="custom-search" />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('custom-search')).toBeInTheDocument()
  })

  // ── Directions integration ─────────────────────────────────────────────────

  it('passes real route estimates when directions resolve', async () => {
    mockSearchPlaces.mockResolvedValue([PLACE_A])
    mockGetDirections.mockResolvedValue({ distance_km: 115.2, duration_min: 85, polyline: 'abc' })
    const user = userEvent.setup()
    renderPage({ locationName: 'Davis', originLat: 38.54, originLng: -121.74 })
    await user.type(screen.getByTestId('search-input'), 'UC')
    await waitFor(() => screen.getAllByTestId('result-item'))
    await user.click(screen.getAllByTestId('result-item')[0])
    await user.click(screen.getByTestId('done-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/ride/confirm', {
        state: {
          destination: PLACE_A,
          estimatedDistanceKm: 115.2,
          estimatedDurationMin: 85,
          polyline: 'abc',
          originLat: 38.54,
          originLng: -121.74,
        },
      })
    })
  })
})
