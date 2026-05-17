/**
 * RateRidePage tests
 *
 * Sprint 2 W-T1-R1+R2 (2026-05-16) — `/ride/rate/:rideId` is now a
 * legacy redirect to `/ride/summary/:rideId`. The 15 form-behavior
 * tests this file used to host migrated to `RideSummaryPage.test.tsx`
 * because the rating + tip form lives there now. This file only
 * verifies the redirect contract so old FCM-tap / email-link URLs
 * keep working.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RateRidePage from '@/components/ride/RateRidePage'

describe('RateRidePage (legacy redirect)', () => {
  it('redirects /ride/rate/:rideId to /ride/summary/:rideId', () => {
    render(
      <MemoryRouter initialEntries={['/ride/rate/ride-001']}>
        <Routes>
          <Route path="/ride/rate/:rideId" element={<RateRidePage />} />
          <Route
            path="/ride/summary/:rideId"
            element={<div data-testid="summary-landed">summary</div>}
          />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('summary-landed')).toBeInTheDocument()
  })

  it('redirects to root when rideId param is missing', () => {
    render(
      <MemoryRouter initialEntries={['/legacy-no-rideid']}>
        <Routes>
          <Route path="/legacy-no-rideid" element={<RateRidePage />} />
          <Route path="/" element={<div data-testid="root-landed">root</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('root-landed')).toBeInTheDocument()
  })
})
