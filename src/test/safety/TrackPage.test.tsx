/**
 * v1.3 Sprint 11 Slice 6 — TrackPage copy regression.
 *
 * Pins the neutral "Live location is being shared" label (was
 * "Driver location is being shared" — misleading when a rider
 * shared the link). Server contract addition to expose share_role
 * is out of user-side parity scope per the Stage 7 audit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TrackPage from '@/components/safety/TrackPage'

vi.mock('@/lib/env', () => ({
  env: {
    GOOGLE_MAPS_KEY: '',
    GOOGLE_MAP_ID: 'map-id',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
  },
}))

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Map: ({ children }: { children: React.ReactNode }) => <div data-testid="track-map">{children}</div>,
  AdvancedMarker: () => null,
  useMap: () => null,
}))

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ride_id: 'ride-1',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      lat: 38.5449,
      lng: -121.7405,
      recorded_at: new Date().toISOString(),
    }),
  })
})

describe('TrackPage', () => {
  it('renders the neutral "Live location is being shared" label (not "Driver location")', async () => {
    render(
      <MemoryRouter initialEntries={['/track/abcd1234']}>
        <Routes>
          <Route path="/track/:token" element={<TrackPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByTestId('track-live-label'))
    expect(screen.getByTestId('track-live-label').textContent).toBe('Live location is being shared')
    expect(screen.queryByText(/Driver location is being shared/)).not.toBeInTheDocument()
  })
})
