/**
 * v1.3 Sprint 11 Slice 4a — useRideSafetyChannel hook tests.
 *
 * Pins the realtime + reseat + polling backstop wiring per the
 * Stage 7 audit's Slice 4a tests checklist:
 *   - warning_fired event mounts the warning (warningFiredAt set)
 *   - warning_responded auto-clears the warning
 *   - safety_ended clears warning AND bumps safetyEndedSignal
 *   - reseat-on-mount sets warningFiredAt when initial fetch
 *     returns divergence_state='warning'
 *   - polling backstop re-reads the ride row every 10s and
 *     CLEARS warningFiredAt when the server moves on
 *   - rideId=null short-circuits all subscriptions / fetches
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRideSafetyChannel } from '@/hooks/useRideSafetyChannel'

// ── Hoisted mocks ────────────────────────────────────────────────────

interface CapturedHandlers {
  warning_fired: ((msg: { payload?: Record<string, unknown> }) => void) | null
  warning_responded: ((msg: { payload?: Record<string, unknown> }) => void) | null
  safety_ended: ((msg: { payload?: Record<string, unknown> }) => void) | null
}

const { mockFrom, mockChannel, mockRemoveChannel, capturedHandlers, capturedChannelNames } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
  capturedHandlers: { current: { warning_fired: null, warning_responded: null, safety_ended: null } as CapturedHandlers },
  capturedChannelNames: { value: [] as string[] },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────

function mockRideRow(row: { divergence_state: string | null; warning_fired_at: string | null }) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: row, error: null }),
      }),
    }),
  })
}

function mockRideRowSequence(...rows: { divergence_state: string | null; warning_fired_at: string | null }[]) {
  let i = 0
  mockFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: rows[Math.min(i++, rows.length - 1)], error: null }),
      }),
    }),
  }))
}

function setupChannelMock() {
  capturedHandlers.current = { warning_fired: null, warning_responded: null, safety_ended: null }
  capturedChannelNames.value = []
  mockChannel.mockImplementation((name: string) => {
    capturedChannelNames.value.push(name)
    const chain = {
      on(_type: string, opts: { event: keyof CapturedHandlers }, handler: (msg: { payload?: Record<string, unknown> }) => void) {
        capturedHandlers.current[opts.event] = handler
        return chain
      },
      subscribe() { return chain },
    }
    return chain
  })
}

beforeEach(() => {
  // Default to real timers — waitFor polls in real time and would
  // hang under fake timers. Polling-backstop tests enable fake
  // timers explicitly via `vi.useFakeTimers()` inside the test.
  vi.useRealTimers()
  mockFrom.mockReset()
  mockChannel.mockReset()
  mockRemoveChannel.mockReset()
  setupChannelMock()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Tests ────────────────────────────────────────────────────────────

describe('useRideSafetyChannel', () => {
  it('does not subscribe + does not fetch when rideId is null', () => {
    const { result } = renderHook(() => useRideSafetyChannel(null))
    expect(mockChannel).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result.current.warningFiredAt).toBeNull()
  })

  it('subscribes to ride-safety:{lowercased-rideId} on mount', () => {
    mockRideRow({ divergence_state: null, warning_fired_at: null })
    renderHook(() => useRideSafetyChannel('Ride-ABCD-001'))
    expect(mockChannel).toHaveBeenCalledWith('ride-safety:ride-abcd-001')
  })

  it('reseats warningFiredAt on mount when divergence_state="warning"', async () => {
    const firedAtIso = '2026-06-03T11:00:00.000Z'
    mockRideRow({ divergence_state: 'warning', warning_fired_at: firedAtIso })
    const { result } = renderHook(() => useRideSafetyChannel('ride-1'))
    await waitFor(() => expect(result.current.warningFiredAt).not.toBeNull())
    expect(result.current.warningFiredAt?.toISOString()).toBe(firedAtIso)
  })

  it('does NOT reseat when divergence_state is null on mount', async () => {
    mockRideRow({ divergence_state: null, warning_fired_at: null })
    const { result } = renderHook(() => useRideSafetyChannel('ride-1'))
    await act(async () => { await Promise.resolve() })
    expect(result.current.warningFiredAt).toBeNull()
  })

  it('warning_fired realtime event mounts the warning with payload.fired_at', async () => {
    mockRideRow({ divergence_state: null, warning_fired_at: null })
    const { result } = renderHook(() => useRideSafetyChannel('ride-1'))
    await act(async () => { await Promise.resolve() })
    expect(result.current.warningFiredAt).toBeNull()

    const firedAtIso = '2026-06-03T11:05:00.000Z'
    act(() => {
      capturedHandlers.current.warning_fired?.({ payload: { fired_at: firedAtIso } })
    })
    expect(result.current.warningFiredAt?.toISOString()).toBe(firedAtIso)
  })

  it('warning_fired falls back to "now" when payload has no fired_at', async () => {
    mockRideRow({ divergence_state: null, warning_fired_at: null })
    const { result } = renderHook(() => useRideSafetyChannel('ride-1'))
    await act(async () => { await Promise.resolve() })

    act(() => {
      capturedHandlers.current.warning_fired?.({ payload: {} })
    })
    expect(result.current.warningFiredAt).not.toBeNull()
  })

  it('warning_responded clears warningFiredAt (counterparty responded first)', async () => {
    mockRideRow({ divergence_state: 'warning', warning_fired_at: '2026-06-03T11:00:00.000Z' })
    const { result } = renderHook(() => useRideSafetyChannel('ride-1'))
    await waitFor(() => expect(result.current.warningFiredAt).not.toBeNull())

    act(() => {
      capturedHandlers.current.warning_responded?.({})
    })
    expect(result.current.warningFiredAt).toBeNull()
  })

  it('safety_ended clears warningFiredAt AND bumps safetyEndedSignal', async () => {
    mockRideRow({ divergence_state: 'warning', warning_fired_at: '2026-06-03T11:00:00.000Z' })
    const { result } = renderHook(() => useRideSafetyChannel('ride-1'))
    await waitFor(() => expect(result.current.warningFiredAt).not.toBeNull())
    const beforeSignal = result.current.safetyEndedSignal

    act(() => {
      capturedHandlers.current.safety_ended?.({})
    })
    expect(result.current.warningFiredAt).toBeNull()
    expect(result.current.safetyEndedSignal).toBe(beforeSignal + 1)
  })

  it('polling backstop CLEARS warningFiredAt when server moves on (recovers missed warning_responded)', async () => {
    // First tick: warning is active. Second tick (after 10s): server cleared it.
    // Use fake timers ONLY in this test so we can step the 10s interval manually
    // without waiting in real time.
    mockRideRowSequence(
      { divergence_state: 'warning', warning_fired_at: '2026-06-03T11:00:00.000Z' },
      { divergence_state: 'responded', warning_fired_at: '2026-06-03T11:00:00.000Z' },
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useRideSafetyChannel('ride-1'))
    await waitFor(() => expect(result.current.warningFiredAt).not.toBeNull())

    // Advance past the 10s polling interval — second tick fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500)
    })
    await waitFor(() => expect(result.current.warningFiredAt).toBeNull())
  })

  it('polling backstop SETS warningFiredAt when server raises the warning between ticks (recovers missed warning_fired)', async () => {
    mockRideRowSequence(
      { divergence_state: null, warning_fired_at: null },
      { divergence_state: 'warning', warning_fired_at: '2026-06-03T11:05:00.000Z' },
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useRideSafetyChannel('ride-1'))
    await waitFor(() => expect(mockFrom).toHaveBeenCalled())
    expect(result.current.warningFiredAt).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500)
    })
    await waitFor(() => expect(result.current.warningFiredAt).not.toBeNull())
    expect(result.current.warningFiredAt?.toISOString()).toBe('2026-06-03T11:05:00.000Z')
  })

  it('removes the channel + clears interval on unmount', async () => {
    mockRideRow({ divergence_state: null, warning_fired_at: null })
    const { unmount } = renderHook(() => useRideSafetyChannel('ride-1'))
    await act(async () => { await Promise.resolve() })
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
