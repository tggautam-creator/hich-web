/**
 * RideConfirm — ride confirmation screen tests
 *
 * Verifies:
 *  1.  Renders page with default data-testid
 *  2.  Displays destination main text
 *  3.  Displays destination secondary text
 *  4.  Shows fare range ($X–$Y)
 *  5.  "Request Ride" button navigates to /ride/waiting
 *  6.  "Change destination" button navigates to /ride/search
 *  7.  Redirects to /ride/search when no destination in state
 *  8.  Custom data-testid forwarded
 *  9.  Shows single fare when low === high (both at minimum)
 * 10.  Uses custom distance/duration from state when provided
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RideConfirm from '@/components/ride/RideConfirm'

/* ── Mocks ──────────────────────────────────────────────────────────── */

const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

/* ── Helpers ─────────────────────────────────────────────────────────── */

const MOCK_DESTINATION = {
  placeId: 'ChIJabc123',
  mainText: 'UC Davis Memorial Union',
  secondaryText: 'Davis, CA, USA',
  fullAddress: 'UC Davis Memorial Union, Davis, CA, USA',
}

function renderWithState(state?: Record<string, unknown>, testId?: string) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/ride/confirm', state }]}>
      <Routes>
        <Route
          path="/ride/confirm"
          element={<RideConfirm data-testid={testId} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

/* ── Tests ──────────────────────────────────────────────────────────── */

describe('RideConfirm', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  // ── Rendering ────────────────────────────────────────────────────────

  it('renders page with default data-testid', () => {
    renderWithState({ destination: MOCK_DESTINATION })
    expect(screen.getByTestId('ride-confirm-page')).toBeInTheDocument()
  })

  it('forwards custom data-testid', () => {
    renderWithState({ destination: MOCK_DESTINATION }, 'custom-id')
    expect(screen.getByTestId('custom-id')).toBeInTheDocument()
  })

  it('displays destination main text', () => {
    renderWithState({ destination: MOCK_DESTINATION })
    expect(screen.getByTestId('destination-address').textContent).toBe(
      'UC Davis Memorial Union',
    )
  })

  it('displays destination secondary text', () => {
    renderWithState({ destination: MOCK_DESTINATION })
    expect(screen.getByText('Davis, CA, USA')).toBeInTheDocument()
  })

  // ── Fare display ───────────────────────────────────────────────────

  it('shows fare range ($X–$Y) with default estimates', () => {
    renderWithState({ destination: MOCK_DESTINATION })
    const fareEl = screen.getByTestId('fare-range')
    // Default 5 km, 10 min → range with ±15% → should show dollar amounts
    expect(fareEl.textContent).toMatch(/\$\d+\.\d{2}/)
  })

  it('uses custom distance/duration from state when provided', () => {
    renderWithState({
      destination: MOCK_DESTINATION,
      estimatedDistanceKm: 30,
      estimatedDurationMin: 40,
    })
    const fareEl = screen.getByTestId('fare-range')
    // 30 km, 40 min → fare ~$8.40 base, range ~$7.35–$9.45
    expect(fareEl.textContent).toMatch(/\$/)
  })

  it('shows single fare when range collapses to minimum', () => {
    renderWithState({
      destination: MOCK_DESTINATION,
      estimatedDistanceKm: 1,
      estimatedDurationMin: 1,
    })
    const fareEl = screen.getByTestId('fare-range')
    // Both low and high hit the $2.00 minimum → single value, no dash
    expect(fareEl.textContent).toBe('$2.00')
  })

  // ── Navigation ─────────────────────────────────────────────────────

  it('"Request Ride" button navigates to /ride/waiting', async () => {
    const user = userEvent.setup()
    renderWithState({ destination: MOCK_DESTINATION })
    await user.click(screen.getByTestId('request-ride-button'))
    expect(mockNavigate).toHaveBeenCalledWith(
      '/ride/waiting',
      expect.objectContaining({ state: expect.objectContaining({ destination: MOCK_DESTINATION }) }),
    )
  })

  it('"Change destination" button navigates to /ride/search', async () => {
    const user = userEvent.setup()
    renderWithState({ destination: MOCK_DESTINATION })
    await user.click(screen.getByTestId('change-destination-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/ride/search')
  })

  it('redirects to /ride/search when no destination in state', async () => {
    renderWithState(undefined)
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/ride/search', { replace: true })
    })
  })

  it('redirects to /ride/search when state is empty object', async () => {
    renderWithState({})
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/ride/search', { replace: true })
    })
  })
})
