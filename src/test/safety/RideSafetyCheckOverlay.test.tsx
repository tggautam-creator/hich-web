/**
 * v1.3 Sprint 11 Slice 4b — RideSafetyCheckOverlay behaviour.
 *
 * Pins the Stage 7 audit's checklist:
 *   - Renders with role-aware subtitle + button labels (rider+driver)
 *   - still-here posts rider_in_car / driver_in_car
 *   - got-out posts rider_left / driver_left + reports fareCents
 *   - help posts help_requested, opens sms with helpComposedBody
 *     when navigator supports sms, falls back to Copy/Share/Close
 *     on desktop, surfaces guidance + 2.5s pause on zero contacts
 *   - 409 NO_ACTIVE_WARNING silently dismisses (no error UI)
 *   - 3 distinct error copies render on submit failure
 *   - WRONG_ROLE 403 path surfaces the error (covers driver-side)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import RideSafetyCheckOverlay from '@/components/safety/RideSafetyCheckOverlay'
import { SafetyWarningResponseApiError } from '@/lib/safetyWarningResponseApi'

// ── Mocks ────────────────────────────────────────────────────────────

const { mockPost } = vi.hoisted(() => ({
  mockPost: vi.fn(),
}))

vi.mock('@/lib/safetyWarningResponseApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/safetyWarningResponseApi')>('@/lib/safetyWarningResponseApi')
  return {
    ...actual,
    postSafetyWarningResponse: mockPost,
  }
})

function ensurePortalRoot() {
  if (!document.getElementById('portal-root')) {
    const el = document.createElement('div')
    el.id = 'portal-root'
    document.body.appendChild(el)
  }
}

beforeEach(() => {
  vi.useRealTimers()
  mockPost.mockReset()
  ensurePortalRoot()
  // Default to desktop UA so canSendSms() returns false in tests
  // unless overridden. Each sms-specific test overrides.
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    configurable: true,
  })
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderOverlay(props: Partial<Parameters<typeof RideSafetyCheckOverlay>[0]> = {}) {
  const defaults = {
    rideId: 'ride-1',
    role: 'rider' as const,
    counterpartyName: 'Jane',
    firedAt: new Date('2026-06-03T12:00:00.000Z'),
    onResolved: vi.fn(),
  }
  return { ...render(<RideSafetyCheckOverlay {...defaults} {...props} />), onResolved: defaults.onResolved }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('RideSafetyCheckOverlay — role-aware copy', () => {
  it('rider sees rider-perspective subtitle + 3 button labels', () => {
    renderOverlay({ role: 'rider' })
    expect(screen.getByTestId('ride-safety-check-overlay')).toBeInTheDocument()
    expect(screen.getByText(/You and your driver appear to be apart/)).toBeInTheDocument()
    expect(screen.getByTestId('ride-safety-check-overlay-still-here').textContent)
      .toBe("I'm still in the car")
    expect(screen.getByTestId('ride-safety-check-overlay-got-out').textContent)
      .toBe('I got out — end the ride')
    expect(screen.getByTestId('ride-safety-check-overlay-help').textContent)
      .toBe("Something's wrong — get help")
  })

  it('driver sees driver-perspective subtitle + counterpartyName-substituted button labels', () => {
    renderOverlay({ role: 'driver', counterpartyName: 'Sam' })
    expect(screen.getByText(/Sam is no longer near the vehicle/)).toBeInTheDocument()
    expect(screen.getByTestId('ride-safety-check-overlay-still-here').textContent)
      .toBe('Sam is still with me')
    expect(screen.getByTestId('ride-safety-check-overlay-got-out').textContent)
      .toBe('Sam got out — end the ride')
    expect(screen.getByTestId('ride-safety-check-overlay-help').textContent)
      .toBe('Report a problem')
  })

  it('driver with null counterpartyName falls back to "Your rider" / "Rider"', () => {
    renderOverlay({ role: 'driver', counterpartyName: null })
    expect(screen.getByText(/Your rider is no longer near the vehicle/)).toBeInTheDocument()
    expect(screen.getByTestId('ride-safety-check-overlay-still-here').textContent)
      .toBe('Rider is still with me')
  })
})

describe('RideSafetyCheckOverlay — still-here action', () => {
  it('rider tap posts rider_in_car + resolves with kind="responded"', async () => {
    mockPost.mockResolvedValueOnce({ ok: true, action: 'rider_in_car', ride_ended: false })
    const { onResolved } = renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-still-here'))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(mockPost).toHaveBeenCalledWith('ride-1', 'rider_in_car')
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ kind: 'responded' }))
  })

  it('driver tap posts driver_in_car', async () => {
    mockPost.mockResolvedValueOnce({ ok: true, action: 'driver_in_car', ride_ended: false })
    renderOverlay({ role: 'driver' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-still-here'))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('ride-1', 'driver_in_car'))
  })
})

describe('RideSafetyCheckOverlay — got-out action', () => {
  it('rider tap posts rider_left + resolves with kind="ended_ride" + fareCents', async () => {
    mockPost.mockResolvedValueOnce({ ok: true, action: 'rider_left', ride_ended: true, fare_cents: 750 })
    const { onResolved } = renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-got-out'))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('ride-1', 'rider_left'))
    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith({ kind: 'ended_ride', fareCents: 750 }),
    )
  })

  it('driver tap posts driver_left', async () => {
    mockPost.mockResolvedValueOnce({ ok: true, action: 'driver_left', ride_ended: true, fare_cents: 500 })
    renderOverlay({ role: 'driver' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-got-out'))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('ride-1', 'driver_left'))
  })
})

describe('RideSafetyCheckOverlay — help action', () => {
  it('help with contacts AND mobile UA opens sms: deep-link with helpComposedBody', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15',
      configurable: true,
    })
    mockPost.mockResolvedValueOnce({
      ok: true,
      action: 'help_requested',
      ride_ended: false,
      share_token: 'abc123',
      trusted_contacts: [
        { id: 'c-1', name: 'Mom', phone: '+15551112222' },
        { id: 'c-2', name: 'Sister', phone: '+15552223333' },
      ],
    })
    // Intercept the sms: navigation
    let navigatedTo: string | null = null
    const origLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...origLocation,
        origin: 'https://tagorides.com',
        set href(v: string) { navigatedTo = v },
      },
    })

    renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-help'))
    await waitFor(() => expect(navigatedTo).not.toBeNull())
    expect(navigatedTo).toContain('sms:+15551112222,+15552223333')
    expect(navigatedTo).toContain(encodeURIComponent("I'm using Tago and might need help."))
    expect(navigatedTo).toContain(encodeURIComponent('https://tagorides.com/track/abc123'))

    // restore
    Object.defineProperty(window, 'location', { configurable: true, value: origLocation })
  })

  it('help with contacts on desktop opens Copy/Close fallback (no sms: navigation)', async () => {
    mockPost.mockResolvedValueOnce({
      ok: true,
      action: 'help_requested',
      ride_ended: false,
      share_token: 'tok-456',
      trusted_contacts: [
        { id: 'c-1', name: 'Mom', phone: '+15551112222' },
      ],
    })
    renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-help'))
    await waitFor(() =>
      expect(screen.getByTestId('ride-safety-check-overlay-help-fallback')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('ride-safety-check-overlay-help-copy')).toBeInTheDocument()
    expect(screen.getByTestId('ride-safety-check-overlay-help-close')).toBeInTheDocument()
  })

  it('help with ZERO contacts surfaces guidance + 2.5s pause before resolving', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockPost.mockResolvedValueOnce({
      ok: true,
      action: 'help_requested',
      ride_ended: false,
      share_token: 'tok-789',
      trusted_contacts: [],
    })
    const { onResolved } = renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-help'))
    await waitFor(() => {
      const err = screen.queryByTestId('ride-safety-check-overlay-error')
      expect(err?.textContent).toContain('No trusted contacts saved')
    })
    // Hasn't resolved yet — still inside the 2.5s pause.
    expect(onResolved).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600)
    })
    expect(onResolved).toHaveBeenCalledWith({ kind: 'help_sent' })
  })
})

describe('RideSafetyCheckOverlay — stale-tap silent dismiss', () => {
  it('409 NO_ACTIVE_WARNING resolves silently with kind="responded" (no error UI)', async () => {
    mockPost.mockRejectedValueOnce(
      new SafetyWarningResponseApiError('NO_ACTIVE_WARNING', 'No active warning', 409),
    )
    const { onResolved } = renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-still-here'))
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ kind: 'responded' }))
    expect(screen.queryByTestId('ride-safety-check-overlay-error')).not.toBeInTheDocument()
  })

  it('409 NOT_ACTIVE resolves silently with kind="responded"', async () => {
    mockPost.mockRejectedValueOnce(
      new SafetyWarningResponseApiError('NOT_ACTIVE', 'Ride not active', 409),
    )
    const { onResolved } = renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-got-out'))
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ kind: 'responded' }))
  })
})

describe('RideSafetyCheckOverlay — error messages', () => {
  it('still-here failure surfaces "Couldn\'t confirm" + re-enables buttons', async () => {
    mockPost.mockRejectedValueOnce(new Error('Server is on fire'))
    renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-still-here'))
    await waitFor(() => {
      expect(screen.getByTestId('ride-safety-check-overlay-error').textContent)
        .toContain("Couldn't confirm")
    })
    // Buttons re-enable after the failure so the user can retry.
    expect(screen.getByTestId('ride-safety-check-overlay-still-here')).not.toBeDisabled()
  })

  it('got-out failure surfaces "Couldn\'t end ride"', async () => {
    mockPost.mockRejectedValueOnce(new Error('500'))
    renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-got-out'))
    await waitFor(() => {
      expect(screen.getByTestId('ride-safety-check-overlay-error').textContent)
        .toContain("Couldn't end ride")
    })
  })

  it('help failure surfaces "Couldn\'t notify"', async () => {
    mockPost.mockRejectedValueOnce(new Error('rate limited'))
    renderOverlay({ role: 'rider' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-help'))
    await waitFor(() => {
      expect(screen.getByTestId('ride-safety-check-overlay-error').textContent)
        .toContain("Couldn't notify")
    })
  })

  it('driver-side WRONG_ROLE 403 surfaces the error (does NOT silently dismiss)', async () => {
    mockPost.mockRejectedValueOnce(
      new SafetyWarningResponseApiError('WRONG_ROLE', "drivers can't tap rider_in_car", 403),
    )
    const { onResolved } = renderOverlay({ role: 'driver' })
    fireEvent.click(screen.getByTestId('ride-safety-check-overlay-still-here'))
    await waitFor(() => {
      expect(screen.getByTestId('ride-safety-check-overlay-error').textContent)
        .toContain("Couldn't confirm")
    })
    expect(onResolved).not.toHaveBeenCalled()
  })
})

describe('RideSafetyCheckOverlay — countdown', () => {
  it('mounts the countdown ring anchored to firedAt (now → fresh 90s)', () => {
    // Anchor to wall-clock now so the test is wall-clock-independent.
    renderOverlay({ firedAt: new Date() })
    const ring = screen.getByTestId('safety-countdown-ring')
    expect(ring).toBeInTheDocument()
    const remaining = Number(ring.getAttribute('data-remaining'))
    expect(remaining).toBeGreaterThan(80)
    expect(remaining).toBeLessThanOrEqual(90)
  })

  it('remounts at the real remaining seconds when firedAt is in the past (resume after reopen)', () => {
    // 60s ago → ~30s remaining
    renderOverlay({ firedAt: new Date(Date.now() - 60 * 1000) })
    const ring = screen.getByTestId('safety-countdown-ring')
    const remaining = Number(ring.getAttribute('data-remaining'))
    expect(remaining).toBeGreaterThan(20)
    expect(remaining).toBeLessThan(40)
  })
})
