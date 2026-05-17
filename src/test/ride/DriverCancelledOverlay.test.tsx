/**
 * DriverCancelledOverlay tests
 *
 * Sprint 2 W-T1-R3 (2026-05-16) — full-screen takeover the rider sees
 * when their driver cancels mid-flow. Web mirror of iOS
 * `DriverCancelledChoiceOverlay.swift`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import DriverCancelledOverlay from '@/components/ride/DriverCancelledOverlay'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: 'test-token' } },
          error: null,
        }),
    },
  },
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DriverCancelledOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders driver-cancelled heading + countdown pill + both CTAs', () => {
    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={0}
        onFindNewDriverSucceeded={() => {}}
        onCancelled={() => {}}
      />,
    )

    expect(screen.getByText('Driver cancelled')).toBeInTheDocument()
    expect(screen.getByTestId('find-another-driver')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-ride')).toBeInTheDocument()
    // Starts at 2:00
    expect(screen.getByTestId('auto-cancel-countdown')).toHaveTextContent(
      'Auto-cancels in 2:00',
    )
  })

  it('uses the plural standby-count copy when more than one driver is standby', () => {
    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={3}
        onFindNewDriverSucceeded={() => {}}
        onCancelled={() => {}}
      />,
    )
    expect(screen.getByTestId('driver-cancelled-subtitle')).toHaveTextContent(
      '3 other drivers are ready to take this ride right now.',
    )
  })

  it('uses the singular copy when exactly one driver is standby', () => {
    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={1}
        onFindNewDriverSucceeded={() => {}}
        onCancelled={() => {}}
      />,
    )
    expect(screen.getByTestId('driver-cancelled-subtitle')).toHaveTextContent(
      '1 other driver is ready to take this ride right now.',
    )
  })

  it('falls back to the generic subtitle when no standby drivers', () => {
    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={0}
        onFindNewDriverSucceeded={() => {}}
        onCancelled={() => {}}
      />,
    )
    expect(screen.getByTestId('driver-cancelled-subtitle')).toHaveTextContent(
      'We can find you another driver, or cancel the ride.',
    )
  })

  it('countdown ticks down each second', async () => {
    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={0}
        onFindNewDriverSucceeded={() => {}}
        onCancelled={() => {}}
      />,
    )
    expect(screen.getByTestId('auto-cancel-countdown')).toHaveTextContent('2:00')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByTestId('auto-cancel-countdown')).toHaveTextContent('1:59')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByTestId('auto-cancel-countdown')).toHaveTextContent('1:54')
  })

  it('Find another driver POSTs /find-new-driver then calls success callback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ride_id: 'ride-001' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const onFind = vi.fn()
    const onCancel = vi.fn()

    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={2}
        onFindNewDriverSucceeded={onFind}
        onCancelled={onCancel}
      />,
    )

    fireEvent.click(screen.getByTestId('find-another-driver'))
    // Drain microtasks (fetch + state updates) without ticking the
    // countdown interval — runAllTimersAsync would infinite-loop on it.
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/rides/ride-001/find-new-driver')
    expect(opts.method).toBe('POST')
    expect(onFind).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Cancel ride PATCHes /cancel then calls cancelled callback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', fetchMock)
    const onFind = vi.fn()
    const onCancel = vi.fn()

    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={0}
        onFindNewDriverSucceeded={onFind}
        onCancelled={onCancel}
      />,
    )

    fireEvent.click(screen.getByTestId('cancel-ride'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/rides/ride-001/cancel')
    expect(opts.method).toBe('PATCH')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onFind).not.toHaveBeenCalled()
  })

  it('find-new-driver API failure surfaces an inline error and re-enables the button', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Server is down' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const onFind = vi.fn()

    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={0}
        onFindNewDriverSucceeded={onFind}
        onCancelled={() => {}}
      />,
    )

    fireEvent.click(screen.getByTestId('find-another-driver'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(onFind).not.toHaveBeenCalled()
    expect(screen.getByTestId('driver-cancelled-error')).toHaveTextContent(
      'Server is down',
    )
    expect(screen.getByTestId('find-another-driver')).not.toBeDisabled()
  })

  it('auto-fires Cancel when the countdown hits zero', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', fetchMock)
    const onCancel = vi.fn()

    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={0}
        onFindNewDriverSucceeded={() => {}}
        onCancelled={onCancel}
      />,
    )

    // Walk the clock all the way down past 0
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    // Drain the cancel fetch + final state-update microtasks. waitFor
    // can't poll under useFakeTimers (its own setInterval is frozen).
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rides/ride-001/cancel',
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('countdown pill turns danger-styled under 30 seconds', async () => {
    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={0}
        onFindNewDriverSucceeded={() => {}}
        onCancelled={() => {}}
      />,
    )

    // 120s → 35s: still warning
    await act(async () => { await vi.advanceTimersByTimeAsync(85_000) })
    expect(screen.getByTestId('auto-cancel-countdown').className).toContain(
      'text-warning',
    )

    // 35s → 29s: flips to danger
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(screen.getByTestId('auto-cancel-countdown').className).toContain(
      'text-danger',
    )
  })

  it('fires the warning vibration on mount when navigator.vibrate exists', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })

    render(
      <DriverCancelledOverlay
        rideId="ride-001"
        standbyCount={0}
        onFindNewDriverSucceeded={() => {}}
        onCancelled={() => {}}
      />,
    )

    expect(vibrate).toHaveBeenCalledWith([60, 40, 60])
  })
})
